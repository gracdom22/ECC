# Revisión de riesgos del diseño

Revisión aplicada con las skills `skills/prediction-market-risk-review` y `skills/llm-trading-agent-security` del repositorio ECC, sobre el diseño de `apps/polymarket-edge` (versión 0.1).

## 1. Alcance revisado

- Escáner que lee precios públicos de Polymarket (Gamma API y CLOB API, solo lectura) y cuotas de Pinnacle vía The Odds API.
- Cálculo de probabilidad justa (quitando el margen de la casa), ventaja esperada (EV) y tamaño con Kelly fraccional.
- Apuestas **simuladas** contra una banca virtual de 1.000 $, guardadas en Supabase.
- Despliegue como un único servicio en Railway con un panel web de solo lectura.

Fuera de alcance, y bloqueado por diseño: cualquier orden real, cartera (wallet), clave privada, frase semilla o firma de transacciones.

## 2. Resultados (pasa / aviso / falla)

### Límite de asesoramiento (prediction-market-risk-review)

| Punto | Resultado | Detalle |
|---|---|---|
| La salida es informativa | PASA | El panel dice "Simulación. Ningún dinero real". Las señales son registros de datos, no recomendaciones de compra. |
| Sin recomendaciones de comprar/vender/tamaño para una persona | AVISO | El sistema calcula un tamaño (Kelly) para la simulación. Es un parámetro del simulador, no un consejo. No usar el panel como señal para apostar dinero real sin la fase de revisión explícita. |
| Decisión humana explícita | PASA | No existe ruta de ejecución real; pasar a dinero real exigiría un plan nuevo y aprobación expresa. |

### Plataforma y regulación

| Punto | Resultado | Detalle |
|---|---|---|
| Restricciones geográficas de la plataforma | AVISO | Gamma marca estos mercados como `restricted: true`. Polymarket limita el acceso según la jurisdicción. Antes de cualquier fase con dinero real hay que confirmar si Mateo (en España) puede operar legalmente. Leer datos públicos no requiere cuenta. |
| Ambigüedad de apuestas o derivados | AVISO | En España las apuestas deportivas están reguladas (DGOJ). Un mercado de predicción sobre deportes puede considerarse juego. Necesita revisión legal antes de usar dinero real. |
| Límites de las APIs | PASA | Polymarket: pocas peticiones por ciclo (1 por liga y un libro de órdenes por candidato). The Odds API: presupuesto mensual repartido por días, más una reserva, y lectura de la cabecera `x-requests-remaining`. |
| No eludir restricciones | PASA | Solo endpoints públicos de lectura. No usa proxies ni VPN, y no cambia el user agent para hacerse pasar por otro cliente. |

### Calidad de datos

| Punto | Resultado | Detalle |
|---|---|---|
| Liquidez y horquilla | PASA | El precio sale del libro de órdenes CLOB real. La compra simulada recorre los niveles del libro y se descarta si no hay profundidad con EV positivo. Si la horquilla supera `MAX_SPREAD` (0,05), no se opera. |
| Comisiones | PASA | Se aplica la comisión taker de Polymarket (`rate × p × (1 − p)`) leída de cada mercado. Si falta, se asume la tarifa deportiva por defecto (más conservador que asumir cero). |
| Precios desfasados | PASA | Las señales se evalúan justo al bajar cuotas frescas. Se rechazan si la línea de Pinnacle tiene más de `MAX_ODDS_AGE_MIN` minutos, o si faltan menos de `MIN_MINUTES_TO_START` para el partido (no se opera en directo). |
| Emparejamiento erróneo | PASA | Se exige que coincidan los dos equipos y que la hora difiera como máximo 3 h. En caso de ambigüedad (dos candidatos casi iguales, o dos partidos sobre el mismo evento) se descarta. Una EV superior al 15 % se marca como `suspect_edge` y nunca se opera. |
| Reglas de resolución | AVISO | Solo se usa el mercado ganador (moneyline/1X2). NBA y NFL incluyen la prórroga; si se cancela el partido, se liquida a 0,5. Hay que comprobar que Pinnacle use la misma regla (prórroga incluida en NBA y NFL; 90 minutos en fútbol). |
| Fuentes etiquetadas | PASA | Cada señal guarda el snapshot de Pinnacle (cuotas brutas, probabilidades justas, margen, método) y el precio de Polymarket por separado. No se usan datos privados ni de Itô. |

### Seguridad

| Punto | Resultado | Detalle |
|---|---|---|
| Claves privadas o frases semilla | PASA | No existen en el código ni en la configuración. |
| Claves fuera de logs | PASA | `ODDS_API_KEY` viaja en la URL, que se censura (`[REDACTED]`) en logs y errores. El logger oculta los campos con nombres tipo secret, password o api_key. |
| Permisos mínimos | PASA | Polymarket y The Odds API: solo lectura. Supabase: RLS activado en las 7 tablas, sin políticas, y permisos revocados a `anon` y `authenticated`. Solo el worker, con la clave secreta, puede leer y escribir. Las funciones `open_paper_trade`, `settle_paper_trade` y `ensure_bankroll` solo las puede ejecutar `service_role`. |
| Disyuntores y límites | PASA | Kelly al 25 %. Máximo por apuesta: el 2 % de la banca y 25 $. Exposición abierta máxima: 25 %. Pérdida diaria máxima: 5 %. Caída máxima desde el pico: 30 %. Como mucho 20 apuestas al día y una por partido (también lo impone un índice único en la base de datos). Interruptor `PAPER_TRADING_ENABLED=false` para registrar señales sin operar. |
| Panel web | PASA | Solo lectura (GET). El texto externo se escapa (XSS) y la cabecera CSP es estricta. Contraseña opcional con `DASHBOARD_PASSWORD`. |

### Privacidad

| Punto | Resultado | Detalle |
|---|---|---|
| Datos mínimos | PASA | No se guardan datos personales ni de cuentas, solo datos públicos de mercado y la banca virtual. |

### Agente de trading con LLM (llm-trading-agent-security)

| Control | Resultado | Detalle |
|---|---|---|
| Inyección de prompts | PASA (no aplica) | No hay ningún LLM en el bucle. Los textos de Polymarket (nombres, preguntas) solo se usan para emparejar y para mostrarlos escapados. |
| Límites de gasto independientes del modelo | PASA | Los disyuntores son código determinista (`src/engine/risk.ts`) y la base de datos comprueba que haya saldo. |
| Simulación antes de enviar | PASA | Todo es simulación. No hay envío. |
| Aislamiento de cartera | PASA (no aplica) | No hay cartera. |
| Registro de decisiones | PASA | Se guardan todas las señales con EV positivo y su estado (`traded`, `below_threshold`, `risk_blocked`, etc.), además de cada llamada a The Odds API (`api_calls`). |

## 3. Acciones bloqueadas

- Enviar órdenes reales a Polymarket, firmar transacciones o pedir o guardar claves de cartera.
- Usar el panel como recomendación de apuesta con dinero real.

## 4. Mitigaciones requeridas antes de una futura fase con dinero real

1. Revisión legal: ¿puede un residente en España operar en Polymarket? ¿Cómo encaja con la normativa de juego (DGOJ)?
2. Comprobar, mercado por mercado, que las reglas de resolución de Polymarket y de Pinnacle coinciden.
3. Al menos varias semanas de resultados simulados, con un número de apuestas suficiente para separar la ventaja real del azar.
4. Un plan de implementación separado, con límites de gasto, prueba previa (dry run), aprobación humana por operación y una cartera dedicada con fondos mínimos. Todo ello requiere la aprobación explícita de Mateo.

## 5. Siguiente paso seguro

Dejar el simulador funcionando con la clave de The Odds API y la clave secreta de Supabase, revisar el panel durante unas semanas y comparar el resultado de la banca virtual con la EV prevista.

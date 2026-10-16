# Polymarket Edge (simulación)

Escáner de **apuestas simuladas** (paper trading) en deportes. Compara el precio de los partidos en Polymarket con la probabilidad "justa" que se deduce de las cuotas de Pinnacle, la casa de apuestas de referencia (la llamada casa *sharp*). Cuando Polymarket está más barato de lo que debería, anota una señal y hace una apuesta simulada contra una banca virtual de 1.000 $.

> No mueve dinero real. No tiene cartera ni claves privadas y no envía ninguna orden a Polymarket.

## Cómo funciona, en cuatro pasos

1. **Lee Polymarket** (gratis, solo lectura). Cada 10 minutos descarga los partidos de las próximas 48 horas de NBA, NFL, Premier League, LaLiga, Bundesliga, Serie A, Ligue 1 y Champions. Solo usa el mercado de quién gana: dos opciones en NBA y NFL, y tres en fútbol (local, empate, visitante).
2. **Lee Pinnacle** a través de The Odds API, región `eu`. El plan gratuito da unas 500 consultas al mes, así que el escáner las reparte: como mucho una consulta por liga cada 6 horas, y solo si esa liga tiene partidos en las próximas 24 horas. Si se acaba el presupuesto del día, espera al día siguiente.
3. **Calcula la ventaja.** A las cuotas de Pinnacle les quita el margen de la casa (lo que se llama *de-vig*) para obtener la probabilidad justa. Después la compara con el precio real del libro de órdenes de Polymarket, incluida su comisión:
   - EV = probabilidad justa / coste por acción − 1
   - Solo se apuesta si la EV está entre el +2 % y el +15 %. Una EV mayor suele indicar un error de datos y se descarta.
4. **Simula la apuesta** con Kelly fraccional al 25 %, con estos topes: 2 % de la banca, 25 $ por apuesta, 25 % de la banca en juego como máximo y una apuesta por partido. Cuando Polymarket resuelve el mercado, la apuesta se liquida sola y la banca se actualiza.

Hay disyuntores de seguridad: el escáner deja de abrir apuestas si se pierde más del 5 % en un día o si la banca cae un 30 % desde su máximo. La revisión completa está en [docs/revision-riesgos.md](docs/revision-riesgos.md).

## Qué ves en el panel

La web del servicio (la URL que da Railway) muestra:

- la banca (efectivo, dinero en juego y resultado acumulado);
- las apuestas simuladas abiertas y las cerradas;
- las últimas señales con EV positiva, cada una con su estado. Por ejemplo, `traded` significa que se apostó, `below_threshold` que la ventaja era demasiado pequeña y `risk_blocked` que se frenó por los límites de riesgo.

Arriba aparece un aviso si falta alguna clave.

## Variables de entorno

| Variable | ¿Obligatoria? | Para qué sirve |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Sí, para guardar datos | Clave secreta de Supabase (empieza por `sb_secret_`). Sin ella, los datos se pierden al reiniciar. |
| `ODDS_API_KEY` | Sí, para generar señales | Clave de [The Odds API](https://the-odds-api.com). Sin ella solo se leen precios de Polymarket. |
| `SUPABASE_URL` | No | Por defecto `https://ylhojqettwscqrobjtze.supabase.co`. |
| `DASHBOARD_PASSWORD` | No | Si la pones, el panel pide contraseña (con cualquier usuario). |
| `PAPER_TRADING_ENABLED` | No | Ponla en `false` para registrar señales sin simular apuestas. |
| `LEAGUES` | No | Ligas separadas por comas: `nba,nfl,epl,laliga,bundesliga,seriea,ligue1,ucl`. |

El resto de ajustes (topes, umbrales, presupuesto de consultas) están en [.env.example](.env.example) y en `src/config.ts`.

## Base de datos (Supabase)

Las migraciones están en `supabase/migrations/`. Crean estas tablas:

| Tabla | Contenido |
|---|---|
| `events` | Partidos de Polymarket. |
| `markets` | Mercados de esos partidos. |
| `odds_snapshots` | Cuotas de Pinnacle y probabilidades justas. |
| `signals` | Oportunidades con EV positiva y qué se hizo con cada una. |
| `paper_trades` | Apuestas simuladas. |
| `bankroll` | Libro de movimientos de la banca virtual. |
| `api_calls` | Registro de consultas a The Odds API. |

Todas las tablas tienen RLS activado y no se pueden leer con la clave pública; solo el servicio, con la clave secreta, accede a ellas.

## Para desarrolladores

```bash
cd apps/polymarket-edge
npm install
npm test               # pruebas (de-vig, edge, Kelly, emparejamiento, liquidación, escáner)
npm run test:coverage  # cobertura (mínimo 80 %)
npm run once           # un ciclo real contra las APIs y muestra el informe
npm run dev            # servicio completo con panel en http://localhost:8080
```

Despliegue: Railway con `Root Directory` = `apps/polymarket-edge`. Usa el `Dockerfile` y el `railway.json` de esta carpeta.

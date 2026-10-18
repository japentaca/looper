// Cálculos puros del preview en sync (toneLib.js; docs/PLAN_EDITOR.md, fase 2): cuándo arranca y cómo se
// repite. Sin Tone ni window (tests en preview_sync.test.js). Tiempos en segundos del AudioContext.

// margen de punto flotante al comparar tiempos (un punto que cae "justo" en now cuenta como alcanzable)
const EPS = 1e-6

// primer punto de la grilla first + k·step (k entero ≥ 0) tal que punto − lead ≥ now; devuelve el punto.
// first = el próximo beat (o compás) del transporte a partir de now; lead = cuánto antes del punto tiene que
// arrancar el audio (0 = arranca en el punto; el pre-roll de un shot, que tiene su anchor en el punto)
export function next_grid_point(now, first, step, lead = 0) {
  if (!(step > 0)) return Math.max(first, now + lead)
  let k = Math.max(0, Math.ceil((now + lead - first) / step - EPS))
  return first + k * step
}

// beats que ocupa cada vuelta de un shot en sync: los que hacen falta para que entre entero (mínimo 1).
// Así las vueltas no se pisan y en cada una el anchor cae en un beat
export function shot_period_beats(dur, spb) {
  if (!(dur > 0) || !(spb > 0)) return 1
  return Math.max(1, Math.ceil(dur / spb - EPS))
}

// arranque de un shot en sync. Se toca en loop un buffer de `period` segundos con el shot (largo `dur`) corrido
// `pad` segundos de silencio, de modo que su anchor (a `pre` segundos de su inicio: el pre-roll, 0..dur; ver
// shot_preroll en region.js) caiga en un beat del buffer (`at` = pad + pre, múltiplo de spb): cada vuelta pone el
// anchor en un beat sin agendar nada más. pre = 0 (anchor start): sin relleno, el shot al principio; pre = dur
// (anchor end): el shot al final, con el silencio adelante. Con el motor andando (engine), first = el próximo beat:
// el anchor cae en el primer beat B con B − pre ≥ now (el shot arranca en el futuro); el buffer "empezaría" en
// B − at, y si eso ya pasó arranca ahora con el offset equivalente (cae dentro del silencio de adelante).
// Con el motor parado arranca ya, con el shot sonando (saltea el silencio).
// Devuelve { time, offset, pad, period } (offset = dentro del buffer con relleno)
export function shot_sync_start({ now, first, spb, dur, pre = 0, engine }) {
  let p = Math.min(Math.max(0, pre), Math.max(0, dur))
  let at = spb > 0 ? Math.ceil(p / spb - EPS) * spb : p
  let pad = Math.max(0, at - p)
  let period = shot_period_beats(pad + dur, spb) * spb
  if (!engine) return { time: now, offset: pad, pad, period }
  let start = next_grid_point(now, first, spb, p) - at
  if (start >= now) return { time: start, offset: 0, pad, period }
  return { time: now, offset: Math.min(pad, now - start), pad, period }
}

// posición dentro del archivo (s) del preview en el instante `now`, o null si todavía no arrancó o si cae en
// el silencio de relleno. c = { start (arranque; sin dato, t0), t0 y off (en t0 el buffer que se toca va por
// off: al arrancar es el offset inicial; al cambiar la velocidad se reancla), rate, wrap (largo de la vuelta
// en el buffer; 0 = sin loop), pad (silencio antes de la región en ese buffer), base (dónde empieza la
// región en el archivo; default 0), len (largo de la región: después, silencio; default sin límite) }
export function preview_pos(c, now) {
  if (now < (c.start ?? c.t0)) return null
  let el = c.off + (now - c.t0) * c.rate
  if (el < 0) return null
  if (c.wrap > 0) el %= c.wrap
  let pos = el - c.pad
  return pos >= 0 && pos < (c.len ?? Infinity) ? (c.base ?? 0) + pos : null
}

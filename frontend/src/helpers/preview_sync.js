// Cálculos puros del preview en sync (toneLib.js; docs/PLAN_EDITOR.md, fase 2): cuándo arranca y cómo se
// repite. Sin Tone ni window (tests en preview_sync.test.js). Tiempos en segundos del AudioContext.

// margen de punto flotante al comparar tiempos (un punto que cae "justo" en now cuenta como alcanzable)
const EPS = 1e-6

// primer punto de la grilla first + k·step (k entero ≥ 0) tal que punto − lead ≥ now; devuelve el punto.
// first = el próximo beat (o compás) del transporte a partir de now; lead = cuánto antes del punto tiene que
// arrancar el audio (0 = arranca en el punto; la duración de un shot con anchor end, que termina en él)
export function next_grid_point(now, first, step, lead = 0) {
  if (!(step > 0)) return Math.max(first, now + lead)
  let k = Math.max(0, Math.ceil((now + lead - first) / step - EPS))
  return first + k * step
}

// beats que ocupa cada vuelta de un shot en sync: los que hacen falta para que entre entero (mínimo 1).
// Así las vueltas no se pisan y cada una empieza (anchor start) o termina (anchor end) en un beat
export function shot_period_beats(dur, spb) {
  if (!(dur > 0) || !(spb > 0)) return 1
  return Math.max(1, Math.ceil(dur / spb - EPS))
}

// arranque de un shot en sync. Se toca en loop un buffer de `period` segundos con el shot al principio
// (anchor start) o al final, con silencio adelante (anchor end, `pad` segundos): cada vuelta empieza o
// termina en un beat sin agendar nada más. Con el motor andando (engine), first = el próximo beat:
// - start: el buffer arranca en ese beat;
// - end: el shot termina en el primer beat B con B − dur ≥ now; el buffer "empezaría" en B − period, y si
//   eso ya pasó arranca ahora con el offset equivalente (cae dentro del silencio de adelante).
// Con el motor parado arranca ya, con el shot sonando (en end, saltea el silencio).
// Devuelve { time, offset, pad, period } (offset = dentro del buffer con relleno)
export function shot_sync_start({ now, first, spb, dur, anchor, engine }) {
  let period = shot_period_beats(dur, spb) * spb
  let pad = anchor == "end" ? Math.max(0, period - dur) : 0
  if (!engine) return { time: now, offset: pad, pad, period }
  if (anchor != "end") return { time: next_grid_point(now, first, spb), offset: 0, pad, period }
  let start = next_grid_point(now, first, spb, dur) - period
  if (start >= now) return { time: start, offset: 0, pad, period }
  return { time: now, offset: Math.min(pad, now - start), pad, period }
}

// fin de la vuelta de un loop en sync, en segundos del buffer: beats × 60 / bpm (lo que dura el loop según
// sus datos; el player lo toca a play_rate, así que en el transporte ocupa exactamente play_beats). Si el
// mp3 decodificado es un poco más largo (relleno del encoder) la vuelta no arrastra ese sobrante y no se
// desfasa de la grilla. Sin datos válidos, el buffer entero; nunca más que el buffer
export function loop_end(beats, bpm, buffer_dur) {
  let len = beats > 0 && bpm > 0 ? beats * 60 / bpm : buffer_dur
  return Math.min(len, buffer_dur)
}

// posición dentro del archivo (s) del preview en el instante `now`, o null si todavía no arrancó o si cae en
// el silencio de relleno. c = { start (arranque; sin dato, t0), t0 y off (en t0 el buffer que se toca va por
// off: al arrancar es el offset inicial; al cambiar la velocidad se reancla), rate, wrap (largo de la vuelta
// en el buffer; 0 = sin loop), pad (silencio antes del archivo en ese buffer) }
export function preview_pos(c, now) {
  if (now < (c.start ?? c.t0)) return null
  let el = c.off + (now - c.t0) * c.rate
  if (el < 0) return null
  if (c.wrap > 0) el %= c.wrap
  let pos = el - c.pad
  return pos >= 0 ? pos : null
}

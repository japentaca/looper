# Plan: efectos de transición (FX) por pista

Efectos de **salida** que se disparan N beats/compases antes de que termine lo que suena en una
pista (modo loop), para suavizar los cambios entre loops, descansos y Tags. Reemplazan al **drift**,
que se elimina.

## Decisiones

- Los efectos son **por pista** (no por archivo). Viven en `trg.props.fx` (JSON dentro de `props`:
  **no cambia el esquema ni la API**, el backend no valida `props`).
- Catálogo **fijo** de tipos (no se crean presets). Se arrastra un tipo desde la sección **FX** de la
  sidebar a una tira de `Tracks.vue` y se crea una **instancia** con valores por defecto; se edita con
  un diálogo (`FxDialog.vue`). Máximo **4** instancias por pista.
- Solo pistas en modo **loop**. Las one-shot ignoran `props.fx` (las instancias se conservan).
- El "fin" es el de la **tirada**: la última repetición de un loop (`repeat_n` pasadas), no cada
  pasada. También es fin el **corte por cambio de Tag** (fase 3).
- El **drift** se elimina (knob, `Tone.Loop`, caminata, `props.drift` de los defaults). Los
  `props.drift` guardados se ignoran (no se migran ni se borran).
- Cada fase en su propio commit.

## Modelo de datos

```js
trg.props.fx = [
  { id: "a1b2c3", type: "lpf", lead: "2m", prob: 1, cond: "any", to_hz: 300, q: 1 },
  { id: "d4e5f6", type: "echo", lead: "1b", prob: 0.5, cond: "rest", level: 0 },
]
```

Comunes a todas las instancias:

| Campo | Valores | Default |
|---|---|---|
| `id` | string corto al azar (único dentro de la pista) | — |
| `type` | `cut` \| `lpf` \| `hpf` \| `fade` \| `echo` \| `verb` | — |
| `lead` | anticipación: `"1b"`, `"2b"` (beats), `"1m"`, `"2m"`, `"4m"`, `"8m"` (compases del compás actual) | según tipo |
| `prob` | 0..1, probabilidad de que se dispare en cada fin | 1 |
| `cond` | `any` (cualquier fin) \| `rest` (solo si lo que sigue es un descanso) \| `tag` (solo si el fin es un corte por cambio de Tag) | `any` |

Por tipo (`helpers/fx.js`, `FX_TYPES`: rótulo, letra del chip, defaults y rangos para el diálogo):

| Tipo | Rótulo / chip | Efecto | Parámetros (default) |
|---|---|---|---|
| `cut` | Cut / C | silencio desde la anticipación hasta el fin (rampa de 5 ms) | `lead` `"1m"` |
| `lpf` | Low-pass / L | pasabajos de 20 kHz a `to_hz` (rampa exponencial) | `lead` `"2m"`, `to_hz` 300 (100..5000), `q` 1 (0..12) |
| `hpf` | High-pass / H | pasaaltos de 10 Hz a `to_hz` (exponencial) | `lead` `"2m"`, `to_hz` 800 (100..5000), `q` 1 (0..12) |
| `fade` | Fade / F | volumen de 0 dB a `to_db` (rampa lineal en ganancia) | `lead` `"2m"`, `to_db` -60 (-60..-6; -60 = silencio) |
| `echo` | Echo throw / E | el send de throw al delay global (pre-Cut/Fade) sube de 0 a `level` dB; vuelve a 0 en el fin y la cola cruza al loop siguiente | `lead` `"1b"`, `level` 0 (-24..0) |
| `verb` | Reverb throw / R | ídem con el send de throw a la reverb | `lead` `"1b"`, `level` 0 (-24..0) |

Los throws tienen sends propios (`throw_send` / `throw_dly_send`, base 0), independientes de los
knobs Rev/Dly: suenan aunque la pista tenga Rev/Dly en off (`null`) y el knob no los afecta.

**Decisión (dub throw)**: los throws toman la señal **antes** de Cut y Fade. Con Cut + Echo throw en
la misma pista, el delay recibe el último tramo y la cola sigue sobre el corte (antes, con los throws
en los sends post-Channel, el delay recibía silencio). Los sends normales de Rev/Dly no cambian:
siguen post-Channel, después de Cut/Fade (un Fade también baja la reverb normal).

## Cadena de audio (mixer.js)

```
player → fx_lp (Tone.Filter lowpass, abierto 20 kHz) → fx_hp (Tone.Filter highpass, abierto 10 Hz)
       → fx_gain (Tone.Gain 1) → Channel → sends (reverb, delay) / meter
                          fx_hp → throw_ch (Channel, no va a Destination) → throw_send (→ reverb)
                                                                          → throw_dly_send (→ delay)
```

- `throw_ch` lleva el mismo volumen, mute y solo que el canal principal (los throws respetan fader,
  mute y solo). El solo de Tone es por contexto; los dos canales de una pista siempre tienen el
  mismo estado, así que el solo entre pistas no cambia.

- `fx_lp` reemplaza al filtro del drift (que se elimina). En reposo los filtros no colorean (Q 0).
- Funciones nuevas en `mixer.js` (los nombres son orientativos):
  - `fx_schedule(trg, inst, start, end)`: agenda la rampa del efecto entre `start` y `end` (tiempos
    de audio de Tone). Cut/LPF/HPF/Fade: rampa del parámetro; throws: `throw_send`/`throw_dly_send` a `level`.
  - `fx_reset(trg, time)`: en el beat del fin, `cancelScheduledValues(time)` y vuelta a la base
    exactamente en `time` (filtros abiertos con su Q base, ganancia 1; los sends de throw a 0 con
    una rampa corta de ~50 ms para no cortar la cola en seco).
  - `fx_reset_all(ramp)`: STOP y RESET dejan todas las pistas neutras ya.
- Mover Rev/Dly mientras un throw está activo: no interactúan (el knob mueve el send normal; el
  throw va por su send propio).

## Motor (Tracks.vue)

- Estado nuevo por track: `next_rest` (resultado anticipado del dado de descanso, `null` = sin
  sortear), `fx_fired` (ids ya evaluados en la tirada actual: cada instancia se evalúa **una vez por
  tirada**), `fx_active` (ids sonando, para los chips; se actualiza con `Tone.Draw`).
- En cada beat de una pista loop con archivo, se calcula **beats hasta el fin** (desde el inicio de
  este beat): `repeats_left * play_beats + remaining_beats + 1` (fin natural). En fase 3 se toma el
  mínimo con el fin por cambio de Tag si el archivo no tiene el Tag siguiente.
- Para cada instancia no evaluada cuyo `lead` en beats sea **≥** a los beats hasta el fin (≥ y no ==,
  así una tirada más corta que la anticipación dispara igual, recortada al tiempo que queda): se marca
  evaluada, se tira `prob`, se chequea `cond` y, si pasa, `fx_schedule(trg, inst, time, time + beats_hasta_fin · seg_por_beat)`.
  Para `cond: "rest"` (o en general, la primera vez que hace falta) se sortea **antes** el dado de
  descanso y se guarda en `track.next_rest`; en el fin, `set_next_step` usa `next_rest` en vez de
  tirar otra vez el dado.
- En el beat del fin (cuando la pista arranca otro archivo, empieza un descanso o la corta el Tag):
  `fx_reset(trg, time)`, `fx_fired` y `next_rest` se limpian. Una repetición del mismo archivo **no**
  es fin.
- STOP y RESET: `fx_reset_all` y limpieza del estado.
- Segundos por beat: `60 / Tone.Transport.bpm.value` (un cambio de tempo en medio de una rampa
  se tolera).

## Cambio de Tag anticipado (fase 3)

- Hoy el Tag nuevo se sortea cuando al actual le queda 1 beat. Pasa a sortearse **al empezar** el
  Tag actual: `current_TAG.next_tag` (con su duración). Cuando el actual termina, `next_tag` pasa a
  ser el actual y se sortea el siguiente. Así se sabe de antemano qué pistas va a cortar el cambio
  (las que suenan un archivo que no tiene `next_tag`) y cuántos beats faltan: `current_TAG.remaining_beats - 1`.
- RESET sigue siendo inmediato (sin transición) y vuelve a sortear el siguiente.
- `cond: "tag"` = el fin de esta tirada es un corte por Tag. Si el fin natural llega antes que el
  cambio de Tag, es un fin natural.
- Los pesos de los Tags editados durante un Tag valen desde el sorteo siguiente (el que ya se
  preseleccionó no cambia). Documentarlo.

## UI

- **Sidebar** (`App.vue`): sección **FX** debajo de Tags con un pad por tipo del catálogo
  (componente nuevo `FxPad.vue`, mismo look de pad pero sin color, borrar ni renombrar). Arrastra con
  `dataTransfer` tipo `looper/fx` y el `type`; **no** pone `msg_type` de track_group/tag (Files.vue no
  debe reaccionar). No se muestra en modo lectura.
- **Tira** (`Tracks.vue`): acepta el drop de `looper/fx` (resaltado como el drop de tiras) y agrega la
  instancia con los defaults; si ya hay 4, aviso con `ElMessage`. En el lugar del knob Drift va una
  fila de **chips** (uno por instancia, con la letra del tipo) que se encienden mientras su efecto
  está activo (`fx_active`). Clic en un chip abre `FxDialog`. En modo lectura los chips se ven
  (encendidos) pero no abren nada.
- **FxDialog.vue** (estilo `hw_dialog`, como el de Files): tipo (solo rótulo), `lead` con pads,
  `prob` con knob, `cond` con pads, los parámetros del tipo con knobs y un botón para quitar la
  instancia. Guarda con `save_trackGroups_debounced()` mientras se edita.

## Fases

1. **Motor y mixer**: `helpers/fx.js` (catálogo, defaults, `lead_beats(lead, beats_x_bar)`),
   cadena nueva en `mixer.js`, quitar el drift (mixer, Tracks.vue, defaults de `composable.js`),
   disparo en el fin natural con `next_rest` anticipado, los 6 tipos. Docs: `ARCHITECTURE.md`,
   `API.md`, `KNOWN_ISSUES.md`.
2. **UI**: `FxPad.vue` en la sidebar, drop en la tira, chips, `FxDialog.vue`. Docs.
3. **Tag anticipado**: `next_tag`, fin por corte de Tag, `cond: "tag"`. Docs.
4. **Revisión**: revisión de todo el diff (bugs, fugas de nodos o eventos, docs al día) y arreglos.

## Pruebas manuales (al final, en el navegador)

- Pista con un loop de 4 compases, Cut `1m`: suena 3 compases y calla el 4.º; el loop siguiente
  entra limpio en el 1.
- LPF `2m` a 300 Hz: cierra en los dos últimos compases y abre de golpe en el loop siguiente.
- Loop de 1 compás con repetición ×8 y LPF `2m`: solo cierra en las dos últimas pasadas.
- `cond: rest` con Rest al 50 %: el efecto solo aparece antes de los descansos.
- Echo throw `1b` con Dly en off: el último beat se repite en el delay sobre lo que sigue.
- Cut `1b` + Echo throw `1b` en la misma pista: el beat cortado se oye igual en el delay (dub throw).
- Echo throw con la pista en mute u otra pista en solo: no manda nada al delay.
- Corte por Tag con `cond: tag` (fase 3): el efecto anticipa el corte.
- STOP y RESET en medio de una rampa: todo vuelve a neutro; el próximo START suena limpio.
- Proyecto viejo con `props.drift`: carga y suena sin errores.

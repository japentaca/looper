import * as Tone from 'tone'
import { store, audio_players } from "../helpers/composable"



export const mainPlayer = new Tone.Player({ onstop: onstop }).toDestination()

// cada start() crea una fuente que termina una sola vez (por stop o al llegar al final):
// si terminaron tantas como se iniciaron, no queda nada sonando
let started = 0
let ended = 0

function onstop() {
  ended++
  if (ended >= started) {
    store.curr_file.isPlaying = false
  }
}

export async function playerStop() {
  await mainPlayer.stop()

}

export async function playFile(file) {
  mainPlayer.stop()
  if (store.curr_file !== file) store.curr_file.isPlaying = false
  store.curr_file = file
  mainPlayer.buffer.set(audio_players[file.id].buffer)
  mainPlayer.volume.value = file.props.volume
  mainPlayer.start()
  started++
  store.curr_file.isPlaying = true
}

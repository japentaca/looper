import * as Tone from 'tone'
import { defineEmits } from 'vue'
import { store, audio_players } from "../helpers/composable"



export const mainPlayer = new Tone.Player({ onstop: onstop }).toDestination()


async function onstop(e) {
  //console.log(e)
  store.curr_file.isPlaying = false
}
let tmr_clock = setInterval(() => {
  if (store.curr_file.isPlaying) {
    store.curr_file.currentTime = mainPlayer.context.currentTime.toFixed()
    //store.curr_file.percent = parseInt((100 / store.curr_file.duration) * parseInt(mainPlayer.context.currentTime))
    //console.log(store.curr_file.duration, store.curr_file.currentTime)

  }
}, 100);

export async function playerStop() {
  await mainPlayer.stop()

}

export async function playFile(file) {

  await mainPlayer.stop()
  setTimeout(async () => {
    store.curr_file = file
    mainPlayer.buffer.set(audio_players[file.id].buffer)
    //console.log(audio_players[file.id])
    mainPlayer.start()
    //audio_players[file.id].start()
    store.curr_file.isPlaying = true
  }, 500);



}
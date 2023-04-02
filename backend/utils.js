import util from 'util'
import child_process from 'child_process';
import { unlink } from 'fs/promises';
const exec = util.promisify(child_process.exec);
async function convert_file(in_file, out_file) {
  let command = global.config.path_to_ffmpeg + ` -i ${in_file} -vn -ar 44100 -ac 2 -b:a 192k ${out_file}`
  console.log(command)
  let res = await runCommand(command)
  console.log("resconvert", res)
  await unlink(in_file)
  return res


}

async function runCommand(command) {
  const { stdout, stderr, error } = await exec(command);
  if (stderr) { console.error('stderr:', stderr); }
  if (error) { console.error('error:', error); }
  return stdout;
}

function get_file_extension(file) {
  let ext = file.split('.').pop()
  return ext.toLowerCase()
}
export default {
  convert_file,
  get_file_extension
}
<template>
  <!-- denuncia de un archivo del catálogo o de un proyecto público (POST /report). Solo con sesión:
    quien lo usa muestra el botón únicamente si hay usuario logueado -->
  <el-dialog v-model="visible" :title="'Report ' + (target?.type == 'project' ? 'project' : 'file')" width="460px"
    align-center append-to-body @open="on_open">
    <p class="target">
      <span class="silk">{{ target?.type == 'project' ? 'Project' : 'File' }}</span>
      <b :title="target?.name">{{ target?.name }}</b>
    </p>
    <el-input v-model="reason" type="textarea" :rows="4" :maxlength="REASON_MAX" show-word-limit
      placeholder="Why should an admin review this? (copyright, offensive content, spam…)" :disabled="sent" />
    <el-alert v-if="msg.text" :type="msg.type" :title="msg.text" :closable="false" show-icon class="msg" />
    <template #footer>
      <el-button @click="visible = false">{{ sent ? "CLOSE" : "CANCEL" }}</el-button>
      <el-button v-if="!sent" type="danger" :loading="busy" :disabled="!reason.trim()" @click="send">REPORT</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive } from "vue"
import { report, error_text } from "../helpers/api"

const visible = defineModel({ type: Boolean, default: false })
const props = defineProps({
  // { type: "file" | "project", id, name }
  target: { type: Object, default: null },
})

// mismo tope que el backend (REPORT_REASON_MAX)
const REASON_MAX = 500

const reason = ref("")
const busy = ref(false)
const sent = ref(false)
const msg = reactive({ type: "success", text: "" })

function on_open() {
  reason.value = ""
  sent.value = false
  Object.assign(msg, { type: "success", text: "" })
}

async function send() {
  if (!props.target || !reason.value.trim()) return
  busy.value = true
  Object.assign(msg, { type: "success", text: "" })
  try {
    let res = await report({ target_type: props.target.type, target_id: props.target.id, reason: reason.value.trim() })
    if (!res.stat) return Object.assign(msg, { type: "error", text: res.text })
    sent.value = true
    Object.assign(msg, {
      type: "success",
      text: res.data?.duplicate ? "You already reported this: it is pending review." : "Report sent: an admin will review it.",
    })
  } catch (e) {
    let status = e?.response?.status
    let text = status == 401 ? "You need to log in to report." : error_text(e)
    Object.assign(msg, { type: "error", text })
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.target {
  margin: 0 0 12px;
  display: flex;
  gap: 10px;
  align-items: baseline;
  overflow: hidden;
}

.target b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg {
  margin-top: 10px;
}
</style>

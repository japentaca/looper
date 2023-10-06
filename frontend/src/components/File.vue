<template>
  <div>
    <h1>{{ message }}</h1>
    <button @click="increment">Increment</button>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const message = ref('Hello, Vue!');
const increment = () => {
  message.value += '!';
};
</script>
import Vue from 'vue'
import VueRouter from 'vue-router'

import Scan from '../views/Scan.vue'
import Result from '../views/Result.vue'

Vue.use(VueRouter)

const routes = [
  { path: '/', redirect: '/scan' },
  { path: '/scan', component: Scan },
  { path: '/result', component: Result },
]

export default new VueRouter({
  mode: 'history',
  routes,
})


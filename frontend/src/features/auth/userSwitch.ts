/**
 * @file 用户切换时的数据重置登记表：聊天、设置 store 在各自模块加载时登记重置函数，
 * authStore 在登录、注册、退出、登录过期时调用 resetUserData 依次执行。
 * authStore 因此不再静态引用这两个 store，它们能随聊天页一起拆出入口 chunk；
 * 还没加载的 store 没有旧数据，不需要重置。
 */

/** 已登记的重置函数 */
const resetters: Array<() => void> = [];

/** 登记一个在用户切换时执行的重置函数；store 模块加载时调用一次 */
export function onUserSwitch(reset: () => void): void {
  resetters.push(reset);
}

/** 用户切换：执行全部已登记的重置，上一个用户的数据不会留到下一个用户 */
export function resetUserData(): void {
  for (const reset of resetters) reset();
}

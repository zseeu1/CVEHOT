// 这个模块的地址：它没有自己的页面，只在后端挂了一个定时任务（server.ts）。
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "gh-poc-scan",
});

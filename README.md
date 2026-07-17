# 续线

一个本地优先的单任务专注工具：随手记下稍后要做的事，同时让“现在”始终只保留一件任务。

在线使用：<https://xuxian-five.vercel.app/>

> Vercel 在中国大陆的访问可能较慢或不可用；遇到无法打开时，可以改用下方的本地运行方式。

## 功能

- 快速添加、切换、完成和恢复任务
- 富文本任务备注
- 自主调整“稍后”任务顺序
- 网页打开期间按时弹窗提醒
- 搜索和统一管理全部任务
- 删除后短时间内撤销

## 数据与隐私

任务数据保存在当前浏览器的 IndexedDB 中，不会上传到服务器。

请注意：

- 不同浏览器、不同设备以及不同网址之间的数据互不相通。
- 清理浏览器站点数据可能删除任务。
- 当前版本尚未提供云同步和自动备份。

## 本地运行

需要 Node.js `22.13.0` 或更高版本。

```powershell
npm install
npm run dev
```

然后打开 <http://localhost:4317/>。Windows 用户也可以双击项目根目录中的 `启动续线.cmd`。

## 构建与验证

```powershell
npm test
npm run lint
```

生产构建使用标准 Next.js，可直接部署到 Vercel。

## 技术栈

- Next.js 16
- React 19
- TypeScript
- IndexedDB
- Tailwind CSS 4

## 许可证

[MIT](LICENSE)

# 交大野协｜0710-0712 顺朝五台小主人抽签

这是适配 Vercel 部署的手机端抽签网页。

## 部署到 Vercel

1. 打开 Vercel，选择 Add New → Project。
2. 导入 GitHub 仓库 `YYC0604/prd`。
3. Root Directory 设置为：`jiaoda-yexie-vercel`。
4. Framework Preset 选 Other 或保持默认。
5. Build Command 留空，Output Directory 留空或填写 `.`。
6. 点击 Deploy。

## 后端

后端仍使用 Google Apps Script + Google Sheet。前端已配置接口：

```text
https://script.google.com/macros/s/AKfycbz4DXON7DMwwp2tApCgu4Or10w-xNIcgf8m8uboDUIMUTJ3xuSMzyMvqSet1cAjbO8JvQ/exec
```

公共仓库里不要提交真实管理员密码。管理员密码只应保存在 Apps Script 后端中。

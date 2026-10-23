<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 本部署的固定介面與送禮流程

- 使用者要求後台、登入與操作提示預設使用繁體中文。新增介面文字須提供繁中翻譯；新瀏覽器或語言偏好失效時也須回到繁中，不能恢復英文預設。保留帳號、品牌、網址與使用者自行輸入的內容。
- 要求追蹤的活動，留言與私訊關鍵字都須先傳「先追蹤」提示及「確認追蹤」按鈕。使用者按下後，再查 Instagram API；只有明確確認已追蹤才傳禮物。已追蹤者也不可略過按鈕；已讀、未知狀態與錯誤都不可放行。
- 編輯介面與預覽須呈現同一流程，不得把兩段確認誤畫成必要連續步驟。
- 2026-10-23 使用者選定：確認追蹤 → 必填 Email → 收件人點驗證信確認 → IG 與 Email 都送禮物。啟用 requireEmail 或 REQUIRE_VERIFIED_EMAIL 時，兩個條件都必須完成；寄送前再查追蹤。領取前不顯示 YouTube／禮物目的網址。
- Email 用於本次領取為必要；後續行銷同意獨立記錄且不預勾，退訂不能被舊領取紀錄恢復。IG／Email 分開記錄寄送結果；不明結果停止自動重寄，已成功的通道不因另一通道失敗而重送。

# Milo 2.0.4 將輸入／語音操作列移到上方

[OPPO Reno13 Pro 下載（arm64，約 24 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.4-arm64.apk)

[其他架構通用 APK（約 71 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.4.apk)

版本代碼 20，Android 8.0 以上，與 2.0.3 相同簽章，可直接覆蓋更新。

## 上方操作，下方對話

可辨識的網頁輸入／語音操作列固定在 App 上方，位於原生「新對話、A−、A+」列下方。保留目前精簡的麥克風、語音及必要的送出／停止按鈕，文字編輯區、附件及模型選單保持隱藏。

對話捲動區預留上方操作列的高度，新對話從操作列下方開始。AI 正在回覆時持續跟隨末行，利用下方螢幕空間。操作列重新建立、語音狀態、畫面旋轉和控制高度變動時會重新計算。

調整原有網頁節點的位置，保留原按鈕和事件，不搬移或複製 React 節點，不更動帳號或語音 API。適用 Milo 內嵌網頁，外部 Chrome 由瀏覽器控制。

## 沿用學習功能

點英文單字可顯示「英文 → KK 音標 → 繁體中文」小視窗，免 API key；長按可選整句，整句不顯示 KK。保留朗讀及 0.5 倍慢讀。

內建約 125,112 筆美式發音與 100,497 筆英中釋義，收錄範圍不完全相同。KK 由 CMUdict 美式 ARPABET 轉寫，採 KK 記號與音節起首規則放置重音，並非 Yahoo 原始 KK。缺少發音不猜測；中文釋義來自 ECDICT，建置時轉為繁體。來源及授權見 [DICTIONARY-LICENSES.txt](DICTIONARY-LICENSES.txt)。

整句及缺少釋義的詞使用 Google ML Kit 裝置端翻譯，首次需下載語言模型，之後可離線使用。Android 10 以上轉成繁體，Android 8／9 沿用模型中文。亮屏與麥克風系統授權流程沿用。

## 本次驗證

58 項 Chromium 檢查通過，含 36 項對話／選字、6 項語音球、16 項精簡操作列。涵蓋上方定位、原按鈕可點擊、短對話避讓、路由重新建立、旋轉／放大、還原底部位置，以及同一輪持續回覆中末字的點位命中。

另有 11 項針對網頁腳本及語音生命週期的 Android/JVM 測試通過；本次未重跑完整 Android 測試套件。正式 Android 腳本、APK 資產與測試來源相符。

檢查使用本機合成頁面，尚未在 OPPO 手機或目前真實 ChatGPT 網站實測；手機效果仍需更新後確認。APK 編譯成功，Lint 0 錯誤、3 項既有提示，兩種 APK 的簽章與 16 KB ZIP 對齊檢查通過。

arm64：24,730,266 bytes，SHA-256 `b0011fcc4f3a4e1444976ef99c03714f4e76b91698fd9bf49c28760e1b4080bc`。

通用版：70,993,688 bytes，SHA-256 `f59b9799026ffc9ee60b66993610495ab31d609736c5cc6e77a5e51a9ecdac35`。

所有歷史 APK 保留。Milo-English-v1.0.apk 為最新通用版相容檔名，完整校驗碼見 SHA256SUMS。

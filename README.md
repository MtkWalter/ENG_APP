# Milo 2.0.3 回覆進行中的即時捲動修正

[OPPO Reno13 Pro 下載（arm64，約 24 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.3-arm64.apk)

[其他架構通用 APK（約 71 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.3.apk)

版本代碼 19，Android 8.0 以上，與 2.0.2 相同簽章，可直接覆蓋更新。

## 同一輪 AI 還在回覆時就跟隨末行

使用者補充：回覆進行時仍被輸入框遮住，等下一輪才上移。本次針對進行中的即時回覆處理：

- 追蹤尚未補齊作者標記的新回覆，包含與使用者共用容器的進行中回覆。
- 讀屏用的 aria-hidden 不再被當作畫面隱藏；依 CSS 實際可見性判斷，並支援 display: contents 作者容器。
- 回覆產生或文字剛更新時，逐畫面檢查末行位置；只有文字動畫而未新增節點時也會調整。
- 閒置時降頻，背景、拖曳、選字及停止處理時暫停監看，返回後恢復。

延續最新 AI 正文、內層與多層捲動、輸入區避讓，以及網站捲到底部控制的處理。適用 Milo 內嵌網頁，外部 Chrome 由瀏覽器控制。

## 沿用學習功能

點英文單字可顯示「英文 → KK 音標 → 繁體中文」小視窗，免 API key；長按可選整句，整句不顯示 KK。保留朗讀及 0.5 倍慢讀。

內建約 125,112 筆美式發音與 100,497 筆英中釋義，收錄範圍不完全相同。KK 由 CMUdict 美式 ARPABET 轉寫，採 KK 記號與音節起首規則放置重音，並非 Yahoo 原始 KK。缺少發音不猜測；中文釋義來自 ECDICT，建置時轉為繁體。來源及授權見 [DICTIONARY-LICENSES.txt](DICTIONARY-LICENSES.txt)。

整句及缺少釋義的詞使用 Google ML Kit 裝置端翻譯，首次需下載語言模型，之後可離線使用。Android 10 以上轉成繁體，Android 8／9 沿用模型中文。亮屏與麥克風系統授權流程沿用。

## 本次驗證

新增五種同一輪未完成回覆的檢查：延後作者標記、可見的讀屏隱藏文字、contents 容器、動畫進行中，以及共用對話容器。前四種重現情境在 2.0.2 失敗，新版均通過。逐段新增文字後的斷言在提交作者標記及開始下一輪之前執行，動畫也在進行中取樣。

51 項 Chromium 檢查通過，含 34 項對話／選字、6 項語音球、11 項精簡控制列。另有 11 項針對網頁腳本及語音生命週期的 Android/JVM 測試通過；本次未重跑完整 Android 測試套件。正式 Android 腳本、APK 資產與測試來源相符。

檢查使用本機合成頁面，尚未在 OPPO 手機或目前真實 ChatGPT 網站實測；手機效果仍需更新後確認。APK 編譯成功，Lint 0 錯誤、3 項提示，兩種 APK 的簽章與 16 KB ZIP 對齊檢查通過。

arm64：24,736,333 bytes，SHA-256 `193a1dbe01cbecfe38d7f5a836eaf0a973c1ec846991acf5c65f5c29b5399dd5`。

通用版：70,999,755 bytes，SHA-256 `aacc797e852efa2a658f21e9ba4328df5afff2e8452f5e96836c9d8146e97361`。

所有歷史 APK 保留。Milo-English-v1.0.apk 為最新通用版相容檔名，完整校驗碼見 SHA256SUMS。

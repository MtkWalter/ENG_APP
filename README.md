# Milo 2.0.2 長 AI 回覆末行顯示修正

[OPPO Reno13 Pro 下載（arm64，約 24 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.2-arm64.apk)

[其他架構通用 APK（約 71 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.2.apk)

版本代碼 18，Android 8.0 以上，與 2.0.1 相同簽章，可直接覆蓋更新。

## AI 回覆變長時，前文往上，結尾留在輸入框上方

依使用者回報的畫面，修正長回覆本身與多層容器的捲動。追蹤最新 AI 正文的最後一行，排除使用者訊息、訊息操作列及讀屏文字；末行保留在輸入／語音操作區上方，較早內容向上移出可視區。

可辨識網站「捲到底部」控制時，使用該控制協助定位。AI 新增文字時恢復跟隨，正在拖曳或選字時暫停；回到 App、查完單字返回後清除未結束的觸碰狀態。連續多輪回覆不會持續增加底部空白，顯示腳本彼此隔離錯誤。

這版調整 2.0.1 的手動捲動規則：AI 新增文字會重新跟隨結尾；AI 沒有更新時可手動查看前文。顯示處理適用 Milo 內嵌網頁，外部 Chrome 由瀏覽器控制。

## 沿用學習功能

點英文單字會顯示「英文 → KK 音標 → 繁體中文」小視窗，不需要 API key；長按可選整句，整句不顯示 KK。保留朗讀與 0.5 倍慢讀。

內建約 125,112 筆美式發音及 100,497 筆英中釋義，收錄範圍不完全相同。KK 根據 CMUdict 美式 ARPABET 發音轉寫，採 KK 記號與音節起首規則放置重音，不是 Yahoo 原始 KK 欄位；缺少發音不猜測。中文釋義來自 ECDICT，建置時轉為繁體。來源與授權見 [DICTIONARY-LICENSES.txt](DICTIONARY-LICENSES.txt)。

整句與缺少釋義的詞使用 Google ML Kit 裝置端翻譯，首次需下載語言模型，之後可離線使用。Android 10 以上轉成繁體，Android 8／9 沿用模型中文。沿用亮屏、麥克風系統授權重用與精簡操作。

## 驗證與限制

46 項 Chromium 檢查通過，包括 29 項對話／選字、6 項語音球、11 項精簡控制列檢查。另有 11 項針對網頁注入與語音生命週期的 Android/JVM 測試通過；本次未重新執行完整 Android 測試套件。

重現項目包含長回覆的內層捲動、hidden／clip 裁切、多層捲動、較新的使用者訊息、操作列與讀屏文字、中文／英文捲到底部控制、AI 逐字新增及查字返回。測試確認捲動控制不會觸發送出或語音按鈕。正式 Android 腳本與 APK 內資產逐一比對相符。

在本機 412 × 850 長回覆重現頁，點位命中檢查顯示末行由不可見變為可見，末行 y=599，輸入區上緣 y=615。這是合成頁面，不能視為 OPPO 實機或現行 ChatGPT 網站已驗證；手機實際效果仍需更新後確認。

APK 編譯成功，Android Lint 0 錯誤、3 項提示；兩種 APK 的簽章與 16 KB ZIP 對齊檢查通過。

arm64：24,733,723 bytes，SHA-256 `cff69371c58e92834014f59e6c49aef651955430871de8ba54ec9419a60d1259`。

通用版：70,997,145 bytes，SHA-256 `63ed45eb171c9dbb42889b36f30398dcd0dc3527ba023c1d3254179e359d42d0`。

全部歷史 APK 保留。Milo-English-v1.0.apk 為最新通用版的相容檔名；完整校驗碼見 SHA256SUMS。

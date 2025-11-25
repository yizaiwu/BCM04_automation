/**
 * BCM04 全流程整合自動化腳本 (V2.6 已確認欄位檢核版)
 * 整合說明：
 * 1. 包含 BCM04-1 ~ BCM04-4 的流程控制。
 * 2. BCM04-5 採用您驗證過的「DOM 強力搜尋 + 解除禁用」邏輯。
 * 3. [新增] 點選客戶前，先檢查「已確認」欄位是否打勾，若已打勾則跳過。
 * 4. [新增] 當整頁客戶皆已確認，自動關閉 BCM04-2 並回到 BCM04-1 繼續作業。
 */
(async function integratedAutomation() {
    console.log("🚀 BCM04 全流程整合自動化腳本 V2.6 (已確認欄位檢核版) 啟動...");

    const failedClients = new Set();
    const completedClients = new Set(); // 記錄已完成(打勾)的客戶

    // ==========================================
    // [核心工具] (源自您提供的無誤版本)
    // ==========================================

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // 判斷元素是否可見
    function isVisible(elem) {
        return !!(elem && (elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length));
    }

    // 等待元素出現 (XPath)
    async function waitForElement(xpath, timeout = 10000) {
        let startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            let result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            let element = result.singleNodeValue;
            if (isVisible(element)) return element;
            await sleep(500);
        }
        return null;
    }

    // 關閉最上層視窗
    function closeTopModal() {
        let closeBtns = Array.from(document.querySelectorAll('button.close, .ngdialog-close, button[title="Close"], span.ui-icon-closethick'));
        let visibleBtns = closeBtns.filter(b => isVisible(b));
        if (visibleBtns.length > 0) {
            visibleBtns[visibleBtns.length - 1].click();
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { 'keyCode': 27, 'which': 27, 'key': 'Escape' }));
        }
    }

    // 強力點擊 (包含強制解除 disabled)
    async function forceClick(element) {
        if (!element) return;

        // 1. 強制移除 disabled 屬性
        if (element.hasAttribute('disabled')) {
            // console.warn("   [工具] 解除按鈕 disabled 狀態");
            element.removeAttribute('disabled');
            element.classList.remove('disabled');
            element.disabled = false;
            await sleep(50);
        }

        try { element.scrollIntoView({ behavior: "auto", block: "center" }); } catch (e) { }

        // 2. 觸發滑鼠事件
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        element.click();
        await sleep(200);
    }

    // ==========================================
    // [BCM04-5 專用] (完全採用您的無誤版本)
    // ==========================================

    // 根據標籤文字尋找對應的自定義下拉選單按鈕
    function findDropdownButton(labelText) {
        const xpath = `//*[contains(text(), '${labelText}') and not(self::script)]`;
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

        for (let i = 0; i < result.snapshotLength; i++) {
            let labelEl = result.snapshotItem(i);
            if (!isVisible(labelEl)) continue;

            let container = labelEl.parentElement;
            let foundBtn = null;

            // 向上遍歷最多 5 層
            for (let depth = 0; depth < 5; depth++) {
                if (!container) break;
                const buttons = container.querySelectorAll('.custom-combobox-toggle');
                if (buttons.length > 0) {
                    for (let btn of buttons) {
                        // 邏輯：按鈕必須在標籤的「後面」(HTML 順序)
                        if (labelEl.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) {
                            foundBtn = btn;
                            break;
                        }
                    }
                }
                if (foundBtn) break;
                container = container.parentElement;
            }
            if (foundBtn) return foundBtn;
        }
        return null;
    }

    // 選擇自定義下拉選單 (主要邏輯)
    async function selectCustomCombobox(labelText, targetIndex) {
        console.log(`   [BCM04-5] 正在設定：${labelText}`);

        // 增加重試機制：有時候按鈕渲染比較慢
        let toggleBtn = null;
        for (let r = 0; r < 5; r++) {
            toggleBtn = findDropdownButton(labelText);
            if (toggleBtn) break;
            await sleep(200);
        }

        if (!toggleBtn) {
            console.error(`   ❌ 在 "${labelText}" 附近找不到下拉按鈕`);
            return false;
        }

        await forceClick(toggleBtn); // 點擊打開選單

        let visibleMenu = null;
        for (let i = 0; i < 10; i++) {
            const menus = document.querySelectorAll('ul.ui-autocomplete');
            for (let menu of menus) {
                if (isVisible(menu)) { visibleMenu = menu; break; }
            }
            if (visibleMenu) break;
            await sleep(100);
        }

        if (!visibleMenu) {
            console.error(`   ❌ 選單未彈出`);
            // 嘗試再點一次
            await forceClick(toggleBtn);
            return false;
        }

        const options = visibleMenu.querySelectorAll('li.ui-menu-item a, li.ui-menu-item');
        if (options.length > targetIndex) {
            // console.log(`      -> 點擊選項：${options[targetIndex].innerText.trim()}`);
            await forceClick(options[targetIndex]);
            return true;
        } else {
            console.error(`   ❌ 選項數量不足`);
            await forceClick(toggleBtn); // 關閉
            return false;
        }
    }

    // 移動項目到右側
    async function moveItemToRight(itemPartialText) {
        console.log(`   [BCM04-5] 移動項目：${itemPartialText}`);

        const xpath = `//option[contains(text(), '${itemPartialText}')]`;
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const option = result.singleNodeValue;

        if (!option) {
            console.error(`   ❌ 找不到項目 "${itemPartialText}"`);
            return false;
        }

        // 選取並觸發 Angular
        option.selected = true;
        option.parentElement.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof angular !== 'undefined') {
            angular.element(option.parentElement).triggerHandler('change');
        }
        await sleep(300);

        let container = option.parentElement.parentElement;
        let moveBtn = null;

        for (let i = 0; i < 6; i++) {
            if (!container) break;
            const buttons = container.querySelectorAll('button, a.btn, div.btn');
            for (let btn of buttons) {
                const txt = btn.innerText.trim();
                if ((txt === '>' || txt === '›' || btn.innerHTML.includes('ui-icon-triangle-1-e') || btn.innerHTML.includes('glyphicon-chevron-right')) && isVisible(btn)) {
                    moveBtn = btn;
                    break;
                }
            }
            if (moveBtn) break;
            container = container.parentElement;
        }

        if (moveBtn) {
            await forceClick(moveBtn);
            console.log(`      -> 已按下移動按鈕`);
            return true;
        } else {
            console.error(`   ❌ 找不到 [>] 移動按鈕`);
            return false;
        }
    }

    // ==========================================
    // 主流程邏輯 (BCM04-1 ~ BCM04-4)
    // ==========================================

    let btnQuery = await waitForElement("//button[contains(text(), '查詢')]", 3000);
    if (btnQuery) {
        console.log("步驟 1: 點擊 BCM04-1 [查詢]");
        await forceClick(btnQuery);
        await sleep(2000);
    }

    while (true) {
        console.log("步驟 2: 尋找 [客戶數] 欄位的星號...");
        let starLink = await waitForElement("//td/a[contains(text(), '*')]", 3000);

        if (!starLink) {
            console.log("✅ 畫面上已無星號，流程結束！");
            alert("乙仔自動化簽核報表小程式已完成！");
            break;
        }

        console.log(">>> 進入星號連結...");
        await forceClick(starLink);
        await sleep(3000); // 等待 BCM04-2 載入

        // 內層迴圈：遍歷 BCM04-2 的客戶
        while (true) {
            // 3. 掃描 BCM04-2 表格內容
            // 先找到表格
            let table = null;
            const tables = document.querySelectorAll('table');
            for (const tbl of tables) {
                if (tbl.innerText.includes('客戶姓名') && tbl.innerText.includes('已確認')) {
                    table = tbl;
                    break;
                }
            }

            if (!table) {
                console.warn("⚠️ 找不到 BCM04-2 表格，可能尚未載入或已關閉");
                // 嘗試關閉當前視窗回到上一層
                closeTopModal();
                await sleep(2000);
                break;
            }

            // 找出所有資料列 (排除標題)
            const rows = table.querySelectorAll('tbody tr');
            if (rows.length === 0 || (rows.length === 1 && rows[0].innerText.includes("無資料"))) {
                console.log(">>> BCM04-2 無資料，返回上一層...");
                closeTopModal();
                await sleep(2000);
                break;
            }

            let targetRow = null;
            let clientName = "";
            let allChecked = true; // 假設全部都已打勾

            // 遍歷每一列，尋找「未打勾」且「未失敗」的客戶
            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                // 假設「已確認」是第 1 欄 (通常是 checkbox)，「客戶姓名」是第 3 欄
                // 根據您的需求，我們需要檢查「已確認」欄位是否打勾
                // 這裡假設 checkbox 在第 1 欄，如果不是請自行調整 index
                // 或者是尋找 row 裡面的 input[type='checkbox']

                const checkInput = row.querySelector('input[type="checkbox"]');
                const nameLink = row.querySelector('a'); // 假設姓名有連結

                if (!nameLink) continue;

                const name = nameLink.innerText.trim();
                const isChecked = checkInput && checkInput.checked; // 檢查是否已打勾

                if (!isChecked) {
                    allChecked = false; // 發現有未打勾的
                    if (!failedClients.has(name) && !completedClients.has(name)) {
                        targetRow = row;
                        clientName = name;
                        break; // 找到目標，跳出迴圈開始處理
                    }
                } else {
                    // 已打勾，加入已完成名單 (避免重複檢查)
                    completedClients.add(name);
                }
            }

            // 判斷結果
            if (allChecked) {
                console.log("✅ BCM04-2 所有客戶皆已確認！關閉視窗，回到上一層...");
                closeTopModal();
                await sleep(2000);
                break; // 跳出內層迴圈，回到 BCM04-1 找下一個星號
            }

            if (!targetRow) {
                console.warn("⚠️ 尚有未打勾客戶，但可能都在黑名單中，無法處理。跳出...");
                closeTopModal();
                await sleep(2000);
                break;
            }

            // 開始處理目標客戶
            console.log(`步驟 3: 點擊客戶 [${clientName}] (未確認)`);
            const clientLink = targetRow.querySelector('a');
            await forceClick(clientLink);

            // 4. BCM04-3 客戶首頁 -> 更多
            console.log("步驟 4: 等待客戶首頁，尋找 [更多>>]...");
            await sleep(3000);

            let moreBtn = document.querySelector("a[ng-click*='toCHSAM120']");
            if (!moreBtn) moreBtn = await waitForElement("//a[contains(text(), '更多')]", 3000);

            if (moreBtn) {
                let executed = false;
                if (typeof angular !== 'undefined') {
                    try {
                        let scope = angular.element(moreBtn).scope();
                        if (scope) {
                            console.log("   -> [Angular] 直接呼叫 toCHSAM120()...");
                            scope.$apply(function () { scope.toCHSAM120('CHSAM120'); });
                            executed = true;
                        }
                    } catch (e) { }
                }

                if (!executed) await forceClick(moreBtn);

                // 確認開啟
                let bcm04_4_Title = await waitForElement("//*[contains(text(), '互動紀錄查詢')]", 5000);
                if (!bcm04_4_Title) {
                    await forceClick(moreBtn); // 再次點擊
                    bcm04_4_Title = await waitForElement("//*[contains(text(), '互動紀錄查詢')]", 5000);
                }

                if (!bcm04_4_Title) {
                    console.error(`❌ [${clientName}] 互動紀錄視窗未開啟。`);
                    failedClients.add(clientName);
                    closeTopModal(); await sleep(1000);
                    continue;
                }

            } else {
                console.error(`❌ [${clientName}] 找不到 [更多] 按鈕`);
                failedClients.add(clientName);
                closeTopModal(); await sleep(1000);
                continue;
            }

            // 5. BCM04-4 互動紀錄查詢 -> 新增
            console.log("步驟 5: 尋找 [新增]...");
            let btnAdd = await waitForElement("//button[contains(text(), '新增')]", 5000);

            if (btnAdd) {
                await forceClick(btnAdd);
            } else {
                console.error(`❌ [${clientName}] 找不到 [新增] 按鈕`);
                failedClients.add(clientName);
                closeTopModal(); await sleep(500);
                closeTopModal(); await sleep(1000);
                continue;
            }

            // 6. BCM04-5 互動記錄新增 (表單填寫)
            console.log("步驟 6: BCM04-5 表單填寫...");

            // 等待表單出現
            let formReady = await waitForElement("//*[contains(text(), '客戶來源')]", 5000);
            if (!formReady) {
                console.error(`❌ [${clientName}] 表單未開啟`);
                failedClients.add(clientName);
                closeTopModal(); closeTopModal(); closeTopModal();
                continue;
            }

            // *** 關鍵：增加 1 秒緩衝，確保下拉選單的按鈕已經渲染出來 ***
            console.log("   -> 等待表單元件渲染...");
            await sleep(1000);

            try {
                // 呼叫您驗證過無誤的邏輯
                await selectCustomCombobox("客戶來源", 1);
                await selectCustomCombobox("聯繫管道", 1);
                await selectCustomCombobox("聯繫結果", 1);
                await selectCustomCombobox("聯繫花費時間", 1);
                await moveItemToRight("定期檢視淨值管理效益");

                console.log("   -> 提交表單 (確定)");
                let btnConfirm = await waitForElement("//button[contains(text(), '確定')]", 2000);
                if (btnConfirm) {
                    await forceClick(btnConfirm);
                    await sleep(2000);
                } else {
                    throw new Error("找不到確定按鈕");
                }

                console.log(`✅ 客戶 [${clientName}] 處理成功`);
                completedClients.add(clientName); // 加入已完成名單

                // 關閉視窗
                console.log("   -> 關閉 BCM04-4");
                closeTopModal();
                await sleep(800);

                console.log("   -> 關閉 BCM04-3");
                closeTopModal();
                await sleep(1000);

                // 此時回到 BCM04-2，迴圈會重新掃描表格，檢查該客戶是否已打勾
                // 如果系統設計是處理完後自動打勾，下次迴圈就會跳過他

            } catch (err) {
                console.error(`❌ [${clientName}] 表單填寫失敗:`, err);
                failedClients.add(clientName);
                closeTopModal(); await sleep(500);
                closeTopModal(); await sleep(500);
                closeTopModal(); await sleep(500);
            }
        }
    }
})();
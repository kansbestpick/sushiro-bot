// scraper.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Playwright interactive scraper...");

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    console.log("Navigating to queue page...");
    await page.goto('https://sushirolic.web.app/desktop.html', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Wait 5 seconds for web app initialization
    await page.waitForTimeout(5000);

    console.log("Extracting live store list & triggering detail clicks...");

    const storesData = await page.evaluate(async () => {
      const results = [];
      const ignoreNames = ['列表', '九龍', '新界', '港島', '即時排隊', '壽司郎', '點選左邊分店'];

      // Find store card containers
      const allElements = Array.from(document.querySelectorAll('div, li, button, article'));
      const storeNodes = allElements.filter(el => {
        const text = el.innerText || '';
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        return lines.some(l => l.includes('店')) && 
               (text.includes('組') || text.includes('分鐘')) && 
               !ignoreNames.some(ign => text.startsWith(ign)) &&
               el.children.length > 0 && el.children.length < 15;
      });

      // Deduplicate stores by branch name
      const uniqueStores = [];
      const seenNames = new Set();

      for (const el of storeNodes) {
        const text = el.innerText || '';
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        const nameLine = lines.find(l => l.includes('店') && !ignoreNames.some(ign => l.includes(ign)) && l.length < 25);
        
        if (nameLine && !seenNames.has(nameLine)) {
          seenNames.add(nameLine);
          uniqueStores.push({ element: el, name: nameLine, text: text });
        }
      }

      // Helper: Dispatch full native mouse click
      function triggerClick(el) {
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
      }

      // Iterate through stores, click card, and parse right-side detail drawer
      for (let i = 0; i < uniqueStores.length; i++) {
        const item = uniqueStores[i];
        const groupMatch = item.text.match(/(\d+)\s*組/);
        const timeMatch = item.text.match(/(\d+)\s*分鐘/);
        
        const groups = groupMatch ? parseInt(groupMatch[1]) : 0;
        const waitTime = timeMatch ? parseInt(timeMatch[1]) : 0;

        let callingNumber = '即時入座';

        if (groups > 0) {
          try {
            // Trigger native mouse event sequence on card
            triggerClick(item.element);
            
            // Wait 450ms for detail drawer re-render
            await new Promise(r => setTimeout(r, 450));

            // Query right-side detail drawer or full page body
            const detailPanel = document.querySelector('[class*="detail"], [class*="right"], [class*="drawer"], [class*="sidebar"]') || document.body;
            const panelText = detailPanel.innerText || document.body.innerText || '';

            // Extract ticket numbers (e.g. A045, 263-267, G38, 176-177)
            const ticketMatch = panelText.match(/(?:現正叫號|叫號|堂食|籌號|叫至)[^\n]*?([A-Za-z]?\s*\d{1,4}(?:\s*[-~至]\s*\d{1,4})?)/i) ||
                                panelText.match(/(\b[A-Za-z]?\d{1,4}\s*[-~至]\s*[A-Za-z]?\d{1,4}\b)/) ||
                                panelText.match(/(\b[A-Za-z]\s*\d{2,4}\b)/);

            if (ticketMatch && ticketMatch[1]) {
              callingNumber = ticketMatch[1].trim().replace(/\s+/g, '');
            } else {
              callingNumber = '叫號中';
            }
          } catch (err) {
            callingNumber = '叫號中';
          }
        }

        results.push({
          id: i + 1,
          name_tc: item.name,
          region: 'KLN', // Region auto-mapping is handled on Blogger frontend
          current_number: callingNumber,
          waiting_groups: groups,
          wait_time: waitTime
        });
      }

      return results;
    });

    console.log(`Successfully extracted ${storesData.length} stores!`);

    const finalPayload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: storesData
    };

    fs.writeFileSync('live_data.json', JSON.stringify(finalPayload, null, 2));
    console.log("Successfully generated live_data.json!");

  } catch (err) {
    console.error("Scraper Error:", err.message);
    const fallbackPayload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: []
    };
    fs.writeFileSync('live_data.json', JSON.stringify(fallbackPayload, null, 2));
  } finally {
    await browser.close();
  }
})();

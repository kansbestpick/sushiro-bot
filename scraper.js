// scraper.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting headless Playwright scraper...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  let queueData = null;

  // 1. Intercept network responses to capture raw JSON payloads automatically
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('outlet') || url.includes('queue') || url.includes('ticket')) {
      try {
        const json = await response.json();
        if (json && (json.outlets || Array.isArray(json))) {
          console.log("Successfully intercepted live queue payload!");
          queueData = json;
        }
      } catch (e) {
        // Non-JSON response, ignore
      }
    }
  });

  try {
    // Navigate to live queue rendered page
    await page.goto('https://sushirolic.web.app/desktop.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 2. Fallback: Parse DOM directly if background XHR wasn't intercepted
    if (!queueData) {
      console.log("Extracting rendered DOM elements...");
      
      const outlets = await page.evaluate(() => {
        const cards = [];
        document.querySelectorAll('div, section, article').forEach((el, index) => {
          const text = el.innerText || '';
          if ((text.includes('店') || text.includes('分店')) && text.includes('現正叫號')) {
            const name = el.querySelector('h1, h2, h3, h4, [class*="name"]')?.innerText.trim() || '壽司郎分店';
            const num = (text.match(/[A-Z]\d+/) || [])[0] || '即時入座';
            const groups = parseInt((text.match(/(\d+)\s*組/) || [])[1] || 0);
            const wait = parseInt((text.match(/(\d+)\s*分鐘/) || [])[1] || 0);

            cards.push({
              id: index + 1,
              name_tc: name,
              region: text.includes('港島') ? 'HK' : text.includes('新界') ? 'NT' : 'KLN',
              current_number: num,
              waiting_groups: groups,
              wait_time: wait
            });
          }
        });
        return cards;
      });

      if (outlets.length > 0) {
        queueData = { outlets };
      }
    }

    if (queueData) {
      const finalPayload = {
        updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
        outlets: queueData.outlets || queueData
      };

      fs.writeFileSync('live_data.json', JSON.stringify(finalPayload, null, 2));
      console.log("Successfully generated live_data.json!");
    } else {
      console.error("Failed to extract queue data.");
      process.exit(1);
    }

  } catch (err) {
    console.error("Scraper Error:", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

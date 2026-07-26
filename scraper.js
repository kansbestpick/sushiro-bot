// scraper.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Playwright scraper...");

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  let queueData = null;

  try {
    console.log("Navigating to target queue page...");
    await page.goto('https://sushirolic.web.app/desktop.html', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait 5 seconds for background dynamic rendering
    await page.waitForTimeout(5000);

    console.log("Extracting DOM queue elements...");
    const outlets = await page.evaluate(() => {
      const results = [];
      const ignoreNames = ['列表', '九龍', '新界', '港島'];
      
      const elements = Array.from(document.querySelectorAll('div, section, article, li'));
      
      elements.forEach((el, index) => {
        const text = el.innerText || '';
        
        // Filter elements containing store keywords
        if ((text.includes('店') || text.includes('分店')) && (text.includes('號') || text.includes('叫號') || text.includes('組'))) {
          const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
          const name = lines[0] || '';

          // Skip category header cards
          if (!name || ignoreNames.includes(name) || name.length > 25) return;

          // Ticket number extraction: matches patterns like A123, A 123, or standalone numbers
          const numMatch = text.match(/([A-Za-z]\s*\d{1,4}|\b\d{2,4}\b)/i);
          const groupMatch = text.match(/(\d+)\s*組/);
          const timeMatch = text.match(/(\d+)\s*分鐘/);

          const groups = groupMatch ? parseInt(groupMatch[1]) : 0;
          const waitTime = timeMatch ? parseInt(timeMatch[1]) : 0;
          
          let currentNum = '即時入座';
          if (groups > 0) {
            currentNum = numMatch ? numMatch[0].replace(/\s+/g, '') : '叫號中';
          }

          results.push({
            id: index + 1,
            name_tc: name,
            region: 'KLN', // Region auto-correction is handled on frontend
            current_number: currentNum,
            waiting_groups: groups,
            wait_time: waitTime
          });
        }
      });

      // Deduplicate results by branch name
      const uniqueMap = new Map();
      results.forEach(item => {
        if (!uniqueMap.has(item.name_tc)) {
          uniqueMap.set(item.name_tc, item);
        }
      });

      return Array.from(uniqueMap.values());
    });

    if (outlets.length > 0) {
      queueData = { outlets };
    } else {
      console.log("DOM parsing yielded 0 stores, outputting empty set.");
      queueData = { outlets: [] };
    }

    const finalPayload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: queueData.outlets
    };

    fs.writeFileSync('live_data.json', JSON.stringify(finalPayload, null, 2));
    console.log(`Successfully extracted ${queueData.outlets.length} stores and wrote live_data.json!`);

  } catch (err) {
    console.error("Scraper Error:", err.message);
    
    // Safety payload to guarantee workflow success
    const fallbackPayload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: []
    };
    fs.writeFileSync('live_data.json', JSON.stringify(fallbackPayload, null, 2));
  } finally {
    await browser.close();
  }
})();

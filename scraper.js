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

    // Wait 5 seconds for background dynamic scripts to render numbers
    await page.waitForTimeout(5000);

    console.log("Extracting exact ticket numbers from DOM...");
    const outlets = await page.evaluate(() => {
      const results = [];
      const ignoreNames = ['列表', '九龍', '新界', '港島', '即時排隊', '壽司郎'];
      
      // Get sub-container elements containing store information
      const allElements = Array.from(document.querySelectorAll('div, section, article, li'));
      
      const cardNodes = allElements.filter(el => {
        const t = el.innerText || '';
        const children = Array.from(el.querySelectorAll('div, section, article'));
        const hasSubCards = children.some(c => (c.innerText || '').includes('店') && (c.innerText || '').includes('組'));
        return t.includes('店') && (t.includes('組') || t.includes('分鐘') || t.includes('叫號')) && !hasSubCards;
      });

      cardNodes.forEach((card, index) => {
        const rawText = card.innerText || '';
        const lines = rawText.split('\n').map(s => s.trim()).filter(Boolean);
        
        // 1. Store Name
        const nameLine = lines.find(l => l.includes('店') && !ignoreNames.some(ign => l.includes(ign)) && l.length < 25) || '';
        if (!nameLine) return;

        // 2. Waiting Groups
        const groupMatch = rawText.match(/(\d+)\s*組/);
        const groups = groupMatch ? parseInt(groupMatch[1]) : 0;

        // 3. Wait Time
        const timeMatch = rawText.match(/(\d+)\s*分鐘/);
        const waitTime = timeMatch ? parseInt(timeMatch[1]) : 0;

        // 4. Exact Ticket Number Extraction
        let ticketNum = '';

        // Strategy A: Find the line directly after "現正叫號" / "叫號"
        const callIndex = lines.findIndex(l => l.includes('現正叫號') || l.includes('叫號'));
        if (callIndex !== -1 && lines[callIndex + 1]) {
          const candidate = lines[callIndex + 1];
          if (!candidate.includes('組') && !candidate.includes('分') && !candidate.includes('等候') && candidate.length < 20) {
            ticketNum = candidate;
          }
        }

        // Strategy B: Regex search for ticket patterns (e.g. A123, B045, 105, A-012)
        if (!ticketNum || ticketNum === '叫號中') {
          const ticketMatch = rawText.match(/([A-Z][-_\s]?\d{1,4}|\b\d{2,4}\b)/i);
          if (ticketMatch) {
            const matchedStr = ticketMatch[0].replace(/\s+/g, '').toUpperCase();
            const numOnly = matchedStr.replace(/\D/g, '');
            // Ensure matched number isn't the group count or wait time
            if (numOnly !== String(groups) && numOnly !== String(waitTime)) {
              ticketNum = matchedStr;
            }
          }
        }

        // Final Fallback Assignment
        if (!ticketNum || ticketNum === '叫號中') {
          ticketNum = (groups === 0) ? '即時入座' : '叫號中';
        }

        results.push({
          id: index + 1,
          name_tc: nameLine,
          region: 'KLN', // Region auto-mapping is handled on frontend
          current_number: ticketNum,
          waiting_groups: groups,
          wait_time: waitTime
        });
      });

      // Deduplicate results by store name
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
      queueData = { outlets: [] };
    }

    const finalPayload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: queueData.outlets
    };

    fs.writeFileSync('live_data.json', JSON.stringify(finalPayload, null, 2));
    console.log(`Extracted ${queueData.outlets.length} stores to live_data.json`);

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

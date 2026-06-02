import crypto from 'crypto';
import puppeteer from 'puppeteer-core';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Funkcija, kas pārvērš eiro summu vārdos latviski
function euroToWords(totalPriceCents) {
  const euros = Math.floor(totalPriceCents / 100);
  if (euros === 0) return "nulle";

  const thou = Math.floor(euros / 1000);
  const rem = euros % 1000;
  let words = "";

  if (thou > 0) {
    const t_h = Math.floor(thou / 100);
    const t_rem_h = thou % 100;
    
    const simti = ["", "viens simts ", "divi simti ", "trīs simti ", "četri simti ", "pieci simti ", "seši simti ", "septiņi simti ", "astoņi simti ", "deviņi simti "];
    words += simti[t_h];

    if (t_rem_h >= 11 && t_rem_h <= 19) {
      const padsmiti = {11:"vienpadsmit ", 12:"divpadsmit ", 13:"trīspadsmit ", 14:"četrpadsmit ", 15:"piecpadsmit ", 16:"sešpadsmit ", 17:"septiņpadsmit ", 18:"astoņpadsmit ", 19:"deviņpadsmit "};
      words += padsmiti[t_rem_h];
    } else {
      const desmiti = ["", "desmit ", "divdesmit ", "trīsdesmit ", "četrdesmit ", "piecdesmit ", "sešdesmit ", "septiņdesmit ", "astoņdesmit ", "deviņdesmit "];
      const vienibas = ["", "viens ", "divi ", "trīs ", "četri ", "pieci ", "seši ", "septiņi ", "astoņi ", "deviņi "];
      words += desmiti[Math.floor(t_rem_h / 10)] + vienibas[t_rem_h % 10];
    }
    words += (t_rem_h !== 11 && t_rem_h % 10 === 1) ? "tūkstotis " : "tūkstoši ";
  }

  const r_h = Math.floor(rem / 100);
  const r_rem_h = rem % 100;
  const simti_r = ["", "viens simts ", "divi simti ", "trīs simti ", "četri simti ", "pieci simti ", "seši simti ", "septiņi simti ", "astoņi simti ", "deviņi simti "];
  words += simti_r[r_h];

  if (r_rem_h >= 11 && r_rem_h <= 19) {
    const padsmiti_r = {11:"vienpadsmit ", 12:"divpadsmit ", 13:"trīspadsmit ", 14:"četrpadsmit ", 15:"piecpadsmit ", 16:"sešpadsmit ", 17:"septiņpadsmit ", 18:"astoņpadsmit ", 19:"deviņpadsmit "};
    words += padsmiti_r[r_rem_h];
  } else {
    const desmiti_r = ["", "desmit ", "divdesmit ", "trīsdesmit ", "četrdesmit ", "piecdesmit ", "sešdesmit ", "septiņdesmit ", "astoņdesmit ", "deviņdesmit "];
    const vienibas_r = ["", "viens ", "divi ", "trīs ", "četri ", "pieci ", "seši ", "septiņi ", "astoņi ", "deviņi "];
    words += desmiti_r[Math.floor(r_rem_h / 10)] + vienibas_r[r_rem_h % 10];
  }

  return words.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const rawBody = await getRawBody(req);
    const bodyString = rawBody.toString('utf8');
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];

    const generatedHash = crypto
      .createHmac('sha256', process.env.SHOPIFY_SECRET)
      .update(bodyString, 'utf8')
      .digest('base64');

    if (generatedHash !== hmacHeader) {
      return res.status(401).send('Unauthorized');
    }

    const order = JSON.parse(bodyString);
    
    let isEducationProduct = false;
    order.line_items.forEach(item => {
      if (item.handle === 'vienreizeja-nodarbibu-samaksa-tehnologiju-nodarbibas-bratus' || item.handle === 'vasaras-nometne-2026') {
        isEducationProduct = true;
      }
    });

    const totalPrice = parseFloat(order.total_price);
    const cents = order.total_price_set.shop_money.amount.split('.')[1] || "00";
    const wordsEuros = euroToWords(Math.round(totalPrice * 100));

    let subtotalHtml = "";
    let vatHtml = "";

    if (isEducationProduct) {
      subtotalHtml = `${totalPrice.toFixed(2)}`;
      vatHtml = `0.00`;
    } else {
      const subNoVat = totalPrice / 1.21;
      const vatCalculated = totalPrice - subNoVat;
      subtotalHtml = `${subNoVat.toFixed(2)}`;
      vatHtml = `${vatCalculated.toFixed(2)}`;
    }

    let itemsRowsHtml = "";
    order.line_items.forEach(item => {
      const itemPrice = parseFloat(item.price);
      const itemLinePrice = parseFloat(item.line_price);
      
      let itemPriceHtml = isEducationProduct ? itemPrice.toFixed(2) : (itemPrice / 1.21).toFixed(2);
      let itemLinePriceHtml = isEducationProduct ? itemLinePrice.toFixed(2) : (itemLinePrice / 1.21).toFixed(2);
      let variantText = (item.variant_title && item.variant_title !== 'Default Title') ? `<br><span style="font-size: 12px; color: #555;">${item.variant_title}</span>` : "";

      itemsRowsHtml += `
        <tr>
          <td style="border-bottom: 1px solid #ccc; padding: 8px 5px;">${item.title}${variantText}</td>
          <td style="border-bottom: 1px solid #ccc; padding: 8px 5px;">Gab.</td>
          <td class="right" style="border-bottom: 1px solid #ccc; padding: 8px 5px; text-align: right;">${item.quantity}</td>
          <td class="right" style="border-bottom: 1px solid #ccc; padding: 8px 5px; text-align: right;">${itemPriceHtml}</td>
          <td class="right" style="border-bottom: 1px solid #ccc; padding: 8px 5px; text-align: right;">${itemLinePriceHtml}</td>
        </tr>
      `;
    });

    let legalNotesHtml = isEducationProduct ? `
      <div style="font-size: 12px; margin: 20px 0; line-height: 1.4;">
        Bērnu un jauniešu interešu izglītības iestāde "Bratus" tehnoloģiju akadēmija<br>
        SIA Bratus struktūrvienība<br>
        Reģ. Nr.: 4351803743<br><br>
        Pamatojoties uz PVN likuma 52. panta 12.punktu, kas nosaka, ka ar pievienotās vērtības nodokli neapliek preču 
        piegādes un pakalpojumus valsts atzītu izglītības iestāžu pakalpojumus vispārējās izglītības, profesionālās 
        izglītības, augstākās izglītības un interešu izglītības jomā, kā arī ar šiem izglītības pakalpojumiem cieši saistītu 
        pakalpojumu sniegšanu un preču piegādi, ko veic minētās izglītības iestādes.
      </div>
    ` : "";

    const dateFormatted = new Date(order.created_at).toLocaleDateString('lv-LV');
    const dueDateFormatted = new Date(new Date(order.created_at).getTime() + 3*24*60*60*1000).toLocaleDateString('lv-LV');

    const invoiceHtml = `
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #000; line-height: 1.4; padding: 20px;">
        <div style="display: table; width: 100%; margin-bottom: 20px;">
          <div style="display: table-cell; width: 50%; vertical-align: top;">
            <div style="font-size: 40px; font-weight: bold; margin-bottom: 20px;">B</div>
            <div style="margin-top: 15px;">
              <strong>Saņēmējs</strong><br>
              ${order.billing_address?.name || ''}<br>
              ${order.billing_address?.company || ''}<br>
              Adrese: ${order.billing_address?.address1 || ''}, ${order.billing_address?.city || ''}, ${order.billing_address?.zip || ''}<br>
              E-pasts: ${order.email}
            </div>
          </div>
          <div style="display: table-cell; width: 50%; vertical-align: top; text-align: right;">
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">Rēķins Nr. ${order.order_name}</div>
            <div>Datums: ${dateFormatted}</div>
            <div>Samaksāt līdz: ${dueDateFormatted}</div>
            <div style="margin-top: 15px; text-align: left; display: inline-block;">
              <strong>Nosūtītājs</strong><br>
              <strong>SIA Bratus</strong><br>
              Adrese: Ķekavas nov., Ķekava,<br>
              Dārzenieku iela 42, LV-2123<br>
              Reģ. Nr.: 40203628316<br>
              PVN Nr.: LV40203628316<br>
              Tālrunis: +371 26484249<br>
              AS Swedbank<br>
              SWIFT/BIC: HABALV22<br>
              Bankas konta numurs: LV64HABA0551060367591
            </div>
          </div>
        </div>
        ${legalNotesHtml}
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr>
              <th style="border-bottom: 2px solid #000; text-align: left; padding: 8px 5px; font-weight: bold;">NOSAUKUMS</th>
              <th style="border-bottom: 2px solid #000; text-align: left; padding: 8px 5px; font-weight: bold;">Mērvienība</th>
              <th style="border-bottom: 2px solid #000; text-align: right; padding: 8px 5px; font-weight: bold;">DAUDZUMS</th>
              <th style="border-bottom: 2px solid #000; text-align: right; padding: 8px 5px; font-weight: bold;">CENA (EUR)</th>
              <th style="border-bottom: 2px solid #000; text-align: right; padding: 8px 5px; font-weight: bold;">KOPĀ (EUR)</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRowsHtml}
          </tbody>
        </table>
        <div style="width: 100%; display: table; margin-top: 20px;">
          <div style="display: table-cell; width: 60%;"></div>
          <div style="display: table-cell; width: 40%;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 5px;">KOPĀ</td><td style="text-align: right; padding: 5px;">€${subtotalHtml}</td></tr>
              <tr><td style="padding: 5px;">PVN 21%</td><td style="text-align: right; padding: 5px;">€${vatHtml}</td></tr>
              <tr style="font-weight: bold; border-top: 2px solid #000;"><td style="padding: 5px;">SUMMA APMAKSAI</td><td style="text-align: right; padding: 5px;">€${totalPrice.toFixed(2)}</td></tr>
            </table>
          </div>
        </div>
        <div style="margin-top: 40px;">
          Rēķinu sagatavoja: SIA Bratus valdes loceklis Rihards Ozoliņš<br><br>
          Vārdiem: ${wordsEuros} eiro, ${cents} centi
        </div>
      </body>
      </html>
    `;

    // Šeit mēs izmantojam Browserless mākoņpārlūku (100% strādās Vercel)
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
    });

    const page = await browser.newPage();
    await page.setContent(invoiceHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.EMAIL_PASS}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'SIA Bratus <sales@bratus.lv>', 
        to: [order.contact_email || order.email],
        subject: `Rēķins par pasūtījumu Nr. ${order.order_name}`,
        html: `<p>Labdien! Paldies par pirkumu SIA Bratus. Pielikumā atradīsiet oficiālo PDF rēķinu Nr. ${order.order_name}.</p>`,
        attachments: [
          {
            filename: `Rekins_${order.order_name}.pdf`,
            content: pdfBuffer.toString('base64')
          }
        ]
      })
    });

    if (resendResponse.ok) {
      console.log(`Rēķins ${order.order_name} aizsūtīts!`);
      return res.status(200).send('OK');
    } else {
      const errText = await resendResponse.text();
      console.error('Resend API kļūda:', errText);
      return res.status(500).send(errText);
    }

  } catch (error) {
    console.error('Servera kļūda:', error);
    return res.status(500).send('Internal Server Error');
  }
}

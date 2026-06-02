import crypto from 'crypto';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import nodemailer from 'nodemailer';

// Vercel specifisks iestatījums: atslēdzam automātisko JSON formatēšanu, 
// lai iegūtu "tīrus" datus Shopify drošības paraksta pārbaudei
export const config = {
  api: {
    bodyParser: false,
  },
};

// Palīgfunkcija "tīro" datu nolasīšanai
async function getRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  // Atļaujam tikai POST pieprasījumus (kādus sūta Shopify)
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const rawBody = await getRawBody(req);
    const bodyString = rawBody.toString('utf8');
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];

    // 1. DROŠĪBAS PĀRBAUDE: Vai sūtītājs ir tieši tavs Shopify veikals?
    const generatedHash = crypto
      .createHmac('sha256', process.env.SHOPIFY_SECRET)
      .update(bodyString, 'utf8')
      .digest('base64');

    if (generatedHash !== hmacHeader) {
      console.error('Neautorizēts piekļuves mēģinājums!');
      return res.status(401).send('Unauthorized');
    }

    // 2. DATU APSTRĀDE
    const order = JSON.parse(bodyString);
    console.log(`Apstrādā pasūtījumu: ${order.order_number}`);

    // 3. HTML RĒĶINA SAGATAVE
    // Šeit vēlāk ievietosim tavu garo rēķina HTML kodu. 
    // Šis ir vienkāršots testa HTML.
    const invoiceHtml = `
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px;">
          <h1>Rēķins Nr. ${order.order_number}</h1>
          <p><strong>Datums:</strong> ${new Date(order.created_at).toLocaleDateString('lv-LV')}</p>
          <p><strong>Klients:</strong> ${order.customer?.first_name || ''} ${order.customer?.last_name || ''}</p>
          <hr>
          <h3>Kopā apmaksai: ${order.total_price} ${order.currency}</h3>
        </body>
      </html>
    `;

    // 4. PDF ĢENERĒŠANA VERCEL VIDĒ (Izmantojot Sparticuz Chromium)
    const executablePath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setContent(invoiceHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    // 5. E-PASTA SŪTĪŠANA
    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"SIA Bratus" <${process.env.EMAIL_USER}>`,
      to: order.contact_email || order.email,
      subject: `Rēķins par pasūtījumu Nr. ${order.order_number}`,
      text: 'Paldies par pirkumu! Jūsu pasūtījums ir veiksmīgi saņemts. Pielikumā atradīsiet rēķinu.',
      attachments: [
        {
          filename: `Rekins_BRJM_${order.order_number}.pdf`,
          content: pdfBuffer
        }
      ]
    });

    console.log(`Rēķins ${order.order_number} nosūtīts!`);
    return res.status(200).send('OK');

  } catch (error) {
    console.error('Sistēmas kļūda:', error);
    return res.status(500).send('Internal Server Error');
  }
}

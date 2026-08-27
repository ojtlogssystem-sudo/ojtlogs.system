const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const cors = require("cors")({origin: true});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "ojtlogs.system@gmail.com",
    pass: "kseo lyic ygad ekpl",
  },
});

exports.sendEvaluationEmail = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send({error: "Method Not Allowed"});
    }

    const {supervisorEmail, companyName, evaluationLink} = req.body;

    if (!supervisorEmail || !companyName || !evaluationLink) {
      return res.status(400).send({error: "Missing required fields"});
    }

    const mailOptions = {
      from: '"OJT-LOGS System" <ANG_GMAIL_MO@gmail.com>',
      to: supervisorEmail,
      subject: `OJT Final Evaluation Access for ${companyName}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc;">
            <div style="max-width: 600px; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; margin: 0 auto;">
                <div style="background-color: #AB0A0A; padding: 20px; text-align: center; color: #ffffff;">
                    <h2 style="margin: 0;">OJT-LOGS SYSTEM</h2>
                    <p style="margin: 5px 0 0; font-size: 13px;">Partner Company Final Evaluation</p>
                </div>
                <div style="padding: 24px; color: #334155;">
                    <p>Magandang araw po,</p>
                    <p>Mayroon po kayong pending na <strong>OJT Final Evaluation</strong> para sa mga intern mula sa kumpanyang <strong>${companyName}</strong>.</p>
                    <p>Mangyaring i-click ang button sa ibaba upang masimulan ang pag-evaluate:</p>
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="${evaluationLink}" target="_blank" style="background-color: #AB0A0A; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Simulan ang Evaluation</a>
                    </div>
                    <p style="font-size: 12px; color: #64748b;">O kopyahin ang link na ito: <br><span style="color: #AB0A0A;">${evaluationLink}</span></p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                    <p style="font-size: 12px; color: #94a3b8; text-align: center;">— OJT Coordinator Office</p>
                </div>
            </div>
        </div>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      return res.status(200).json({
        success: true,
        message: "Email sent successfully!",
      });
    } catch (error) {
      logger.error("Error sending email:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
});
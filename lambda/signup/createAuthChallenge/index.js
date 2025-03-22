import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region:  process.env.AWS_REGION}); 

export const handler = async (event) => {
    console.log("Create Auth Challenge:", JSON.stringify(event, null, 2));

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Generate OTP
    const email = event.request.userAttributes.email;

    await sendOTPEmail(email, otp);

    event.response.publicChallengeParameters = { email };
    event.response.privateChallengeParameters = { otp };
    event.response.challengeMetadata = "OTP_CHALLENGE";

    return event;
};


async function sendOTPEmail(email, otp) {
    const params = {
        Source: "alwin@appmastery.co", 
        Destination: { ToAddresses: [email] },
        Message: {
            Subject: { Data: "Your OTP Code" },
            Body: { Text: { Data: `Your OTP is: ${otp}` } }
        }
    };

    try {
        await ses.send(new SendEmailCommand(params));
        console.log("OTP PARAMS:", params)
        console.log("OTP:", otp)
        console.log("OTP email sent successfully");
    } catch (error) {
        console.error("Error sending email:", error);
    }
}

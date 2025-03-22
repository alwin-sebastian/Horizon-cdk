export const handler = async (event) => {
    console.log("Verify Auth Challenge:", JSON.stringify(event, null, 2));
  
    const expectedOtp = event.request.privateChallengeParameters.otp; // Changed from 'answer' to 'otp'
    const userOtp = event.request.challengeAnswer;
  
    console.log(`Expected OTP: ${expectedOtp}, User provided OTP: ${userOtp}`);
    
    event.response.answerCorrect = expectedOtp === userOtp;
    
    return event;
  };
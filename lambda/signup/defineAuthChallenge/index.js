export const handler = async (event) => {
    console.log("Define Auth Challenge:", JSON.stringify(event, null, 2));
  
    if (event.request.session.length === 0) {
        event.response.challengeName = "CUSTOM_CHALLENGE";
    } else {
        event.response.issueTokens = event.request.session[0].challengeResult;
        event.response.failAuthentication = !event.response.issueTokens;
    }
  
    return event;
  };
  
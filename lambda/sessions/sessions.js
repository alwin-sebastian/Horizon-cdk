// sessions.js
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  ScanCommand,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
// import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.SESSIONS_TABLE_NAME;

/**
 * Helper function to get current EST date and time
 */
const getCurrentESTDateTime = () => {
  const estOffset = -4;
  const now = new Date();
  const utcDate = now.getTime() + (now.getTimezoneOffset() * 60000);
  const estDate = new Date(utcDate + (3600000 * estOffset));
  
  return {
    dateString: estDate.toISOString().split('T')[0], // YYYY-MM-DD
    timeString: estDate.toISOString().split('T')[1].substring(0, 5), // HH:MM
    isoString: estDate.toISOString(),
    date: estDate
  };
};

/**
 * Gets all sessions scheduled for today that haven't already happened
 */
export const getTodaysSessions = async (event) => {
  try {
    const { dateString, timeString, date } = getCurrentESTDateTime();
    
    console.log(`Current EDT date: ${dateString}, current EDT time: ${timeString}`);
    
    // Start of today in EDT
    const todayStart = new Date(date);
    todayStart.setHours(0, 0, 0, 0);
    
    // End of today in EDT
    const todayEnd = new Date(date);
    todayEnd.setHours(23, 59, 59, 999);
    
    // Convert to ISO strings
    const todayStartISO = todayStart.toISOString();
    const todayEndISO = todayEnd.toISOString();
    const nowISO = date.toISOString();
    
    // Get just the date part for the begins_with operation
    const todayDatePart = todayStartISO.split('T')[0];
    
    console.log(`Query for date starting with: ${todayDatePart}, current time: ${nowISO}`);
    
    // Use a scan operation with a filter expression 
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(session_date_time, :todayDate)',
      ExpressionAttributeValues: {
        ':todayDate': todayDatePart
      }
    };
    
    const result = await ddbDocClient.send(new ScanCommand(params));
    const Items = result.Items || [];
    
    // Separate sessions into current and upcoming
    const currentSessions = [];
    const upcomingSessions = [];
    
    // Determine session duration (default to 60 minutes if not specified)
    Items.forEach(session => {
      const sessionStartTime = new Date(session.session_date_time);
      
      // Calculate end time based on duration
      const durationMinutes = parseDuration(session.duration);
      const sessionEndTime = new Date(sessionStartTime.getTime() + durationMinutes * 60000);
      
      const currentTime = new Date(nowISO);
      
      // If the session is happening now (current time is between start and end)
      if (sessionStartTime <= currentTime && currentTime <= sessionEndTime) {
        currentSessions.push(session);
      } 
      // If the session is in the future
      else if (sessionStartTime > currentTime) {
        upcomingSessions.push(session);
      }
    });
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        sessions: upcomingSessions,
        current_sessions: currentSessions,
        count: upcomingSessions.length,
        current_count: currentSessions.length,
        message: 'Successfully retrieved today\'s sessions'
      })
    };
  } catch (error) {
    console.error('Error retrieving sessions:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        sessions: [],
        current_sessions: [],
        count: 0,
        current_count: 0,
        message: 'Error retrieving today\'s sessions',
        error: error.message
      })
    };
  }
};

function parseDuration(durationStr) {
  if (!durationStr) return 60; // Default to 60 minutes
  
  // Handle formats like "1:30" (1 hour 30 minutes) or just "60" (60 minutes)
  if (durationStr.includes(':')) {
    const [hours, minutes] = durationStr.split(':').map(Number);
    return (hours * 60) + minutes;
  } else {
    return parseInt(durationStr, 10);
  }
}

/**
 * Gets all sessions (optionally filtered by status, mentor_id, or date range)
 */
export const getAllSessions = async (event) => {
  try {
    const queryParams = event.queryStringParameters || {};
    
    // Start with a scan operation
    let params = {
      TableName: TABLE_NAME
    };
    
    // If filtering by date range, use a query instead of scan
    if (queryParams.start_date && queryParams.end_date) {
        // Convert date strings to ISO format
        const startDate = new Date(`${queryParams.start_date}T00:00:00-04:00`).toISOString();
        const endDate = new Date(`${queryParams.end_date}T23:59:59-04:00`).toISOString();
        
        // Use scan with filter expression instead of query with key condition
        params = {
          TableName: TABLE_NAME,
          FilterExpression: 'session_date_time BETWEEN :startDate AND :endDate',
          ExpressionAttributeValues: {
            ':startDate': startDate,
            ':endDate': endDate
          }
        };
        
        const result = await ddbDocClient.send(new ScanCommand(params));
        const Items = result.Items || [];
      
      // Apply additional filters (if any)
      let filteredItems = Items;
      
      if (queryParams.status) {
        filteredItems = filteredItems.filter(session => session.session_status === queryParams.status);
      }
      
      if (queryParams.mentor_id) {
        filteredItems = filteredItems.filter(session => session.mentor_id === queryParams.mentor_id);
      }
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          sessions: filteredItems,
          count: filteredItems.length,
          message: 'Successfully retrieved sessions'
        })
      };
    }
    
    // Otherwise, perform a scan with filters if needed
    const result = await ddbDocClient.send(new ScanCommand(params));
    const Items = result.Items || [];
    
    // Apply filters from query parameters
    let filteredItems = Items;
    
    if (queryParams.status) {
      filteredItems = filteredItems.filter(session => session.session_status === queryParams.status);
    }
    
    if (queryParams.mentor_id) {
      filteredItems = filteredItems.filter(session => session.mentor_id === queryParams.mentor_id);
    }
    
    if (queryParams.date) {
      const dateStart = new Date(`${queryParams.date}T00:00:00-05:00`).toISOString();
      const dateEnd = new Date(`${queryParams.date}T23:59:59-05:00`).toISOString();
      
      filteredItems = filteredItems.filter(session => 
        session.session_date_time >= dateStart && session.session_date_time <= dateEnd
      );
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        sessions: filteredItems,
        count: filteredItems.length,
        message: 'Successfully retrieved sessions'
      })
    };
  } catch (error) {
    console.error('Error retrieving all sessions:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        sessions: [],
        count: 0,
        message: 'Error retrieving sessions',
        error: error.message
      })
    };
  }
};

/**
 * Gets a specific session by ID
 */
export const getSessionById = async (event) => {
  try {
    const sessionId = event.pathParameters.session_id;
    
    const params = {
      TableName: TABLE_NAME,
      Key: {
        session_id: sessionId
      }
    };
    
    const { Item } = await ddbDocClient.send(new GetCommand(params));
    
    if (!Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          message: 'Session not found',
          session: null
        })
      };
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        session: Item,
        message: 'Session retrieved successfully'
      })
    };
  } catch (error) {
    console.error('Error fetching session:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        message: 'Error fetching session',
        session: null,
        error: error.message
      })
    };
  }
};

/**
 * Creates a new session
 */
export const createSession = async (event) => {
  try {
    const requestBody = JSON.parse(event.body);
    
    // Validate required fields
    const requiredFields = ['session_name', 'session_status', 'session_type', 'mentor_id', 
                           'session_date_time', 'duration', 'session_objective'];
    
    const missingFields = requiredFields.filter(field => !requestBody[field]);
    if (missingFields.length > 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          message: `Missing required fields: ${missingFields.join(', ')}` 
        })
      };
    }
    
    // Generate a unique ID if not provided
    const sessionId = requestBody.session_id;
    
    // Validate date_time format
    let sessionDateTime;
    try {
      sessionDateTime = new Date(requestBody.session_date_time);
      if (isNaN(sessionDateTime)) {
        throw new Error("Invalid date format");
      }
      
      // Convert to ISO string
      sessionDateTime = sessionDateTime.toISOString();
    } catch (e) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          message: 'Invalid session_date_time format. Please use ISO 8601 format (e.g., "2025-03-21T14:30:00-05:00")' 
        })
      };
    }
    
    const item = {
      session_id: sessionId,
      session_name: requestBody.session_name || null,
      session_status: requestBody.session_status || null,
      session_type: requestBody.session_type || null,
      mentor: requestBody.mentor || null,
      mentor_id: requestBody.mentor_id || null,
      session_date_time: sessionDateTime || null,
      duration: requestBody.duration || null,
      session_objective: requestBody.session_objective || null,
      session_outcome: requestBody.session_outcome || null,
      location: requestBody.location || null,
      session_image: requestBody.session_image || null,
      created_at: new Date().toISOString()
    };
    
    const params = {
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(session_id)'
    };
    
    await ddbDocClient.send(new PutCommand(params));
    
    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        session: item,
        message: 'Session created successfully'
      })
    };
  } catch (error) {
    console.error('Error creating session:', error);
    
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          message: 'A session with this ID already exists',
          session: null
        })
      };
    }
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        message: 'Error creating session',
        session: null,
        error: error.message
      })
    };
  }
};

/**
 * Updates an existing session
 */
export const updateSession = async (event) => {
  try {
    const sessionId = event.pathParameters.session_id;
    const requestBody = JSON.parse(event.body);
    
    // Check if the session exists
    const getParams = {
      TableName: TABLE_NAME,
      Key: {
        session_id: sessionId
      }
    };
    
    const { Item } = await ddbDocClient.send(new GetCommand(getParams));
    
    if (!Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          message: 'Session not found',
          session: null
        })
      };
    }
    
    // Validate date_time format if provided
    if (requestBody.session_date_time) {
      try {
        const sessionDateTime = new Date(requestBody.session_date_time);
        if (isNaN(sessionDateTime)) {
          throw new Error("Invalid date format");
        }
        
        // Convert to ISO string
        requestBody.session_date_time = sessionDateTime.toISOString();
      } catch (e) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ 
            message: 'Invalid session_date_time format. Please use ISO 8601 format (e.g., "2025-03-21T14:30:00-05:00")',
            session: null
          })
        };
      }
    }
    
    // Build update expression
    let updateExpression = 'SET';
    let expressionAttributeNames = {};
    let expressionAttributeValues = {};
    
    // List of fields that can be updated
    const updatableFields = [
      'session_name',
      'session_status',
      'session_type',
      'mentor',
      'mentor_id',
      'session_date_time',
      'duration',
      'session_objective',
      'session_outcome',
      'location',
      'session_image'
    ];
    
    let fieldCount = 0;
    updatableFields.forEach(field => {
      if (requestBody[field] !== undefined) {
        const attributeName = `#${field}`;
        const attributeValue = `:${field}`;
        
        updateExpression += fieldCount === 0 ? ` ${attributeName} = ${attributeValue}` : `, ${attributeName} = ${attributeValue}`;
        expressionAttributeNames[attributeName] = field;
        expressionAttributeValues[attributeValue] = requestBody[field];
        
        fieldCount++;
      }
    });
    
    // Add updated_at timestamp
    updateExpression += fieldCount === 0 ? ' #updated_at = :updated_at' : ', #updated_at = :updated_at';
    expressionAttributeNames['#updated_at'] = 'updated_at';
    expressionAttributeValues[':updated_at'] = new Date().toISOString();
    
    const updateParams = {
      TableName: TABLE_NAME,
      Key: {
        session_id: sessionId
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };
    
    const { Attributes } = await ddbDocClient.send(new UpdateCommand(updateParams));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        session: Attributes,
        message: 'Session updated successfully'
      })
    };
  } catch (error) {
    console.error('Error updating session:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        message: 'Error updating session',
        session: null,
        error: error.message
      })
    };
  }
};

/**
 * Deletes a session
 */
export const deleteSession = async (event) => {
  try {
    const sessionId = event.pathParameters.session_id;
    
    const params = {
      TableName: TABLE_NAME,
      Key: {
        session_id: sessionId
      }
    };
    
    await ddbDocClient.send(new DeleteCommand(params));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'Session deleted successfully'
      })
    };
  } catch (error) {
    console.error('Error deleting session:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        message: 'Error deleting session',
        error: error.message
      })
    };
  }
};

/**
 * Main handler that routes to the appropriate function based on the HTTP method and path
 */
export const handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  try {
    // Determine which function to call based on the HTTP method and path
    const httpMethod = event.httpMethod;
    const path = event.path;
    console.log(`Processing path: "${path}", HTTP method: ${httpMethod}`);
    if (httpMethod === 'GET') {
      if (path.endsWith('/sessions/today')) {
        return await getTodaysSessions(event);
      } else if (event.pathParameters && event.pathParameters.session_id) {
        return await getSessionById(event);
      } else {
        return await getAllSessions(event);
      }
    } else if (httpMethod === 'POST') {
      return await createSession(event);
    } else if (httpMethod === 'PUT' && event.pathParameters && event.pathParameters.session_id) {
      return await updateSession(event);
    } else if (httpMethod === 'DELETE' && event.pathParameters && event.pathParameters.session_id) {
      return await deleteSession(event);
    } else {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          message: 'Invalid request',
          sessions: []
        })
      };
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        message: 'Internal server error',
        sessions: [],
        error: error.message
      })
    };
  }
};
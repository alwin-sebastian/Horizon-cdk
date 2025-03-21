# upload_file.py - Python Lambda function for file uploads and processing
import json
import base64
import os
import boto3
import logging
from langchain_community.document_loaders import LLMSherpaFileLoader

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize S3 client
s3 = boto3.client('s3')
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'tbdc-pitchdecks')

def process_file(file_url, file_type):
    try:
        logger.info(f"(LLM SHERPA) Processing file from URL: {file_url}")
        loader = LLMSherpaFileLoader(
            file_path=file_url,
            llmsherpa_api_url=os.environ.get("LLMSHERPA_API_URL"),
        )
        documents = loader.load()
        logger.info("(LLM SHERPA) SUCCESS: File processed")
        return documents
    except Exception as e:
        logger.error(f"(LLM SHERPA) Error processing file {file_type}: {e}")
        raise

def lambda_handler(event, context):
    try:
        # Parse request body
        body = json.loads(event['body'])
        
        if not all(key in body for key in ['fileName', 'fileContent', 'contentType']):
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'message': 'Missing required fields: fileName, fileContent, and contentType are required'})
            }
        
        # Extract file details
        file_name = body['fileName']
        file_content = base64.b64decode(body['fileContent'])
        content_type = body['contentType']
        
        # Upload to S3
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=file_name,
            Body=file_content,
            ContentType=content_type
        )
        
        # Generate S3 URL
        file_url = f"https://{BUCKET_NAME}.s3.amazonaws.com/{file_name}"
        
        # Process file with LLMSherpa
        extracted_text = ""
        try:
            documents = process_file(file_url, content_type)
            # Combine text from all documents
            extracted_text = "\n\n".join([doc.page_content for doc in documents])
        except Exception as e:
            logger.error(f"Error extracting text: {str(e)}")
            # Continue even if text extraction fails
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'message': 'File uploaded successfully',
                'fileName': file_name,
                'fileUrl': file_url,
                'extractedText': extracted_text
            })
        }
    
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'message': 'Error processing file', 'error': str(e)})
        }
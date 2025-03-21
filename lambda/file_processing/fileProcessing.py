import json
import base64
import os
import boto3
import logging
import tempfile
import requests
from langchain_community.document_loaders import LLMSherpaFileLoader

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize S3 client
s3 = boto3.client('s3')
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'tbdc-pitchdecks')

def process_file(file_path, file_type):
    try:
        logger.info(f"(LLM SHERPA) Processing local file: {file_path}")
        
        # Check environment variable
        sherpa_api_url = os.environ.get("LLMSHERPA_API_URL")
        logger.info(f"Using LLMSherpa API URL: {sherpa_api_url}")
        
        if not sherpa_api_url:
            raise ValueError("LLMSHERPA_API_URL environment variable not set")
        
        # Initialize loader with local file path
        loader = LLMSherpaFileLoader(
            file_path=file_path,
            llmsherpa_api_url=sherpa_api_url,
        )
        
        # Load documents
        documents = loader.load()
        logger.info(f"(LLM SHERPA) SUCCESS: Loaded {len(documents)} documents")
        return documents
    except Exception as e:
        import traceback
        logger.error(f"(LLM SHERPA) Error processing file {file_type}: {e}")
        logger.error(traceback.format_exc())
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
        
        # Save content to a temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file_name)[1]) as temp_file:
            temp_file.write(file_content)
            temp_file_path = temp_file.name
        
        logger.info(f"Saved file to temporary location: {temp_file_path}")
        
        # Process file with LLMSherpa
        extracted_text = ""
        try:
            documents = process_file(temp_file_path, content_type)
            # Combine text from all documents
            extracted_text = "\n\n".join([doc.page_content for doc in documents])
        except Exception as e:
            logger.error(f"Error extracting text: {str(e)}")
            # Continue even if text extraction fails
        finally:
            # Clean up the temporary file
            try:
                os.unlink(temp_file_path)
            except:
                pass
        
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
        import traceback
        logger.error(f"Error processing request: {str(e)}")
        logger.error(traceback.format_exc())
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'message': 'Error processing file', 'error': str(e)})
        }
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  region: 'eu-central-003',
  accessKeyId: process.env.B2_KEY_ID,
  secretAccessKey: process.env.B2_SECRET,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});

const BUCKET = 'Lizard';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request received');
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    console.log('Invalid HTTP method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { userId } = req.query;
    console.log('userId query param:', userId);
    
    // List all objects in the bucket
    const list = await s3.listObjectsV2({
      Bucket: BUCKET,
      Prefix: ''
    }).promise();
    
    console.log('Total objects found:', list.Contents?.length || 0);
    
    if (!list.Contents || list.Contents.length === 0) {
      console.log('No contents in bucket');
      return res.json({ success: true, shorts: [] });
    }
    
    const allKeys = list.Contents.map(item => item.Key);
    console.log('All keys:', allKeys);
    
    // Filter for JSON metadata files (format: meta-{userId}-{timestamp}.json)
    const metadataKeys = allKeys.filter(key => 
      key.startsWith('meta-') && key.endsWith('.json')
    );
    
    console.log('Metadata files found:', metadataKeys);
    
    // Fetch and parse all metadata files
    const shorts = await Promise.all(
      metadataKeys.map(async (key) => {
        try {
          const obj = await s3.getObject({
            Bucket: BUCKET,
            Key: key
          }).promise();
          
          const body = obj.Body.toString('utf-8');
          console.log(`Content of ${key}:`, body.substring(0, 200));
          
          const metadata = JSON.parse(body);
          
          console.log('Original URLs:', { 
            videoUrl: metadata.videoUrl, 
            thumbnailUrl: metadata.thumbnailUrl 
          });
          
          // Ensure URLs are absolute
          if (metadata.videoUrl && !metadata.videoUrl.startsWith('http')) {
            metadata.videoUrl = `https://s3.eu-central-003.backblazeb2.com/${BUCKET}/${metadata.videoUrl}`;
          }
          if (metadata.thumbnailUrl && !metadata.thumbnailUrl.startsWith('http')) {
            metadata.thumbnailUrl = `https://s3.eu-central-003.backblazeb2.com/${BUCKET}/${metadata.thumbnailUrl}`;
          }
          
          console.log('Final URLs:', { 
            videoUrl: metadata.videoUrl, 
            thumbnailUrl: metadata.thumbnailUrl 
          });
          
          return metadata;
        } catch (e) {
          console.error('Error parsing metadata file:', key, e.message);
          return null;
        }
      })
    );
    
    // Filter out any nulls from parse errors
    const validShorts = shorts.filter(s => s !== null);
    console.log('Valid shorts count:', validShorts.length);
    
    // Filter by userId if provided
    const filtered = userId
      ? validShorts.filter(s => s.userId === userId)
      : validShorts;
    
    console.log('Filtered shorts count:', filtered.length);
    
    // Sort by upload date (newest first)
    filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    
    console.log('Returning shorts:', filtered.map(s => ({ id: s.id, title: s.title })));
    
    res.json({ success: true, shorts: filtered });
  } catch (error) {
    console.error('❌ Error fetching shorts:', error);
    res.status(500).json({ 
      error: 'Failed to fetch shorts', 
      details: error.message 
    });
  }
};

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Create log entry with timestamp
    const logEntry = {
      timestamp: new Date().toISOString(),
      body: body
    };
    
    // Define log file path
    const logDir = path.join(process.cwd(), 'log');
    const logFile = path.join(logDir, 'room-temp.log');
    
    // Ensure logs directory exists
    await fs.mkdir(logDir, { recursive: true });
    
    // Append to log file
    await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
    
    console.log('Room temperature data logged:', logEntry);
    
    return NextResponse.json({ success: true, message: 'Data logged successfully' });
  } catch (error) {
    console.error('Error logging room temperature data:', error);
    return NextResponse.json(
      { error: 'Failed to log data' },
      { status: 500 }
    );
  }
}
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

// Set the HF_TOKEN environment variable
// process.env.HF_TOKEN = "";

const app = express();
const port = 3000;

    // Set up multer for file uploads
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            const sessionId = req.body.session_id; // Use sessionId from the request body
            const uploadPath = path.join(__dirname, `uploads/${sessionId}`);
            fs.access(uploadPath, fs.constants.W_OK, (err) => {
                if (err) {
                    fs.mkdirSync(uploadPath, { recursive: true });
                }
                cb(null, uploadPath);
            });
        },
        filename: (req, file, cb) => {
            const sessionId = req.body.session_id; // Use sessionId from the request body
            cb(null, `audio_file_${sessionId}.wav`);
        }
    });
    const upload = multer({ storage });

//test endpoint
app.get('/test', (req, res) => {
    res.send('Hello World');
});

//endpoint to handle image upload 



// Endpoint to handle audio file upload
app.post('/upload/audio', upload.single('file'), (req, res) => { // Ensure the field name matches the client
    const audioFilePath = req.file.path;
    const sessionId = req.body.session_id; // Declare sessionId once
    const outputDir = path.join(__dirname, `output/${sessionId}`);
    const maxSpeakers = req.body.max_speakers;
    const botId = req.body.bot_id;
    console.log(sessionId + ' max speakers: ' + maxSpeakers);
    console.log('--------------------------------');
    console.log('Bot ID: ' + req.body.bot_id);
    console.log('--------------------------------');
    // Create the output directory if it doesn't exist
    fs.access(outputDir, fs.constants.W_OK, (err) => {
        if (err) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Construct the WhisperX CLI command
        const command = 'bash';
        const args = ['-c', `source ./demovenv/bin/activate && whisperx ${audioFilePath} --compute_type int8 --diarize --max_speakers ${maxSpeakers} --hf_token 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`];

        // Set the environment variable to force float32 precision
        const env = { ...process.env, TORCH_DTYPE: 'float32' };

        // Execute the command
        const childProcess = spawn(command, args, { env });

        childProcess.stdout.on('data', (data) => {
            console.log(`WhisperX output: ${data}`);
        });

        childProcess.stderr.on('data', (data) => {
            console.warn(`WhisperX stderr: ${data}`);
        });

        childProcess.on('error', (err) => {
            console.error(`Failed to start subprocess: ${err.message}`);
            return res.status(500).send('Error processing audio file.');
        });

        childProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`WhisperX process exited with code ${code}`);
                return res.status(500).send('Error processing audio file.');
            }
            console.log('WhisperX process completed successfully.');
            
            // Move all files starting with "audio" from the root project folder to the relevant output session folder
            const files = fs.readdirSync(__dirname);
            files.forEach(file => {
                if (file.startsWith('audio')) {
                    const oldPath = path.join(__dirname, file);
                    const newFileName = file.replace('audio', 'transcription');
                    const newPath = path.join(outputDir, newFileName);
                    fs.renameSync(oldPath, newPath);
                }
            });

            // Find the .srt file in the output directory
            const outputFiles = fs.readdirSync(outputDir);
            const srtFile = outputFiles.find(file => file.endsWith('.srt'));

            if (!srtFile) {
                console.error('No .srt file found in the output directory.');
                return res.status(500).send('Error processing audio file.');
            }

            const srtFilePath = path.join(outputDir, srtFile);
            const convertedTxtFilePath = path.join(outputDir, srtFile.replace('.srt', '_converted.txt'));

            fs.readFile(srtFilePath, 'utf8', (err, data) => {
                if (err) {
                    console.error(`Failed to read .srt file: ${err.message}`);
                    return res.status(500).send('Error processing audio file.');
                }

                // Write the content to the converted .txt file
                fs.writeFile(convertedTxtFilePath, data, 'utf8', (err) => {
                    if (err) {
                        console.error(`Failed to write converted .txt file: ${err.message}`);
                        return res.status(500).send('Error processing audio file.');
                    }
                    console.log('.srt file converted to .txt file successfully.');
                    
                    // Log session completion
                    console.log(`${sessionId} is complete.`);

                    // Log file paths for the next API call
                    const transcriptionFilePath = path.join(outputDir, `transcription_file_${sessionId}_converted.txt`);
                    const imageUrlFilePath = path.join(__dirname, `images/${sessionId}/image_urls_${sessionId}.txt`);
                    console.log(`Transcription file: ${transcriptionFilePath}`);
                    console.log(`Image URL file: ${imageUrlFilePath}`);

                    // Read and encode files to base64
                    const transcriptionFile = fs.readFileSync(transcriptionFilePath, 'utf8');
                    const imageUrlFile = fs.readFileSync(imageUrlFilePath, 'utf8');

                    const transcriptionFileBase64 = Buffer.from(transcriptionFile).toString('base64');
                    const imageUrlFileBase64 = Buffer.from(imageUrlFile).toString('base64');

                    // Prepare the request body
                    const requestBody = {
                        transcription_file: {
                            filename: path.basename(transcriptionFilePath),
                            contents: transcriptionFileBase64
                        },
                        image_url_file: {
                            filename: path.basename(imageUrlFilePath),
                            contents: imageUrlFileBase64
                        },
                        bot_id: botId
                    };

                    // Send the POST request
                    axios.post('https://api.ohanapay.app/api/1.1/wf/transcribe_session', requestBody)
                        .then(response => {
                            console.log('Files sent successfully:', response.data);
                            res.send('Audio file processed and converted successfully.');
                        })
                        .catch(error => {
                            console.error('Error sending files to API:', error.message);
                            res.status(500).send('Error sending files to API.');
                        });

                });
            });
        });
    });
});

// Set up multer for image uploads
const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const sessionId = req.body.session_id; // Use sessionId from the request body
        const uploadPath = path.join(__dirname, `images/${sessionId}`);
        fs.access(uploadPath, fs.constants.W_OK, (err) => {
            if (err) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }
            cb(null, uploadPath);
        });
    },
    filename: (req, file, cb) => {
        const sessionId = req.body.session_id; // Use sessionId from the request body
        const currentTime = req.body.current_time; // Use current_time from the request body
        cb(null, `image_${sessionId}_${currentTime}${path.extname(file.originalname)}`);
    }
});
const imageUpload = multer({ storage: imageStorage });

// Serve static files from the 'uploads' directory
app.use('/images', express.static(path.join(__dirname, 'images')));

// Endpoint to handle image file upload
app.post('/upload/image', imageUpload.single('file'), (req, res) => { // Ensure the field name matches the client
    const imageFilePath = req.file.path;
    const sessionId = req.body.session_id; // Declare sessionId once
    const imageUrl = `https://transcribe.ohanapal.bot/images/${sessionId}/${req.file.filename}`;
    const imageUrlsFilePath = path.join(__dirname, `images/${sessionId}/image_urls_${sessionId}.txt`);

    console.log(`Image uploaded for session: ${sessionId}`);
    console.log(`Image URL: ${imageUrl}`);

    // Append the image URL to the text file
    fs.appendFile(imageUrlsFilePath, `${imageUrl}\n`, (err) => {
        if (err) {
            console.error(`Failed to write image URL to file: ${err.message}`);
            return res.status(500).send('Error saving image URL.');
        }
        res.send('Image file uploaded successfully.');
    });
});

// * Logger middleware
app.use((req, res, next) => {
    res.on("finish", () => {
      console.log(req.method, req.hostname, req.path, res.statusCode, res.statusMessage, new Date(Date.now()))
    });
    next();
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

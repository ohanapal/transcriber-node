const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");
const { OpenAI } = require("openai");
require("dotenv").config();


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
async function uploadToOpenAI(vectorStoreId, filePath, botId) {
  try {
    // Upload the file to OpenAI
    const file = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "assistants", // Ensure this is the correct purpose for your use case
    });

    console.log("File uploaded to OpenAI:", file);

    // Associate the file with the vector store
    const myVectorStoreFile = await openai.beta.vectorStores.files.create(
      vectorStoreId,
      {
        file_id: file.id,
      }
    );

    console.log("File associated with vector store:", myVectorStoreFile);

    // Send POST request to the external API
    const externalApiUrl = `${process.env.EXTERNAL_BACKEND_URL}/bots/upload-external`;
    const fakeFile = {
      originalname: path.basename(filePath), // File name
      size: fs.statSync(filePath).size,      // File size in bytes
    };

    const postData = {
      name: fakeFile.originalname,
      size: fakeFile.size,
      file_id: myVectorStoreFile.id, // File ID from vector store
      bot_id: botId,                 // Provided bot ID
    };

    const externalApiResponse = await fetch(externalApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(postData),
    });

    if (!externalApiResponse.ok) {
      const errorResponse = await externalApiResponse.json();
      throw new Error(
        `Failed to send data to external API: ${
          errorResponse.message || "Unknown error"
        }`
      );
    }

    console.log("Data successfully sent to the external API.");

    return myVectorStoreFile;
  } catch (error) {
    console.error("Error uploading to OpenAI:", error.message);
    throw new Error("Failed to upload file to OpenAI");
  }
}



// Set the HF_TOKEN environment variable
// process.env.HF_TOKEN = "";

const app = express();
const port = 3000;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.session_id; // req.body is now populated
    console.log("Session ID from Multer destination:", sessionId);
    const uploadPath = path.join(__dirname, `uploads/${sessionId}`); // Fallback to 'default'

    fs.access(uploadPath, fs.constants.W_OK, (err) => {
      if (err) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    });
  },
  filename: (req, file, cb) => {
    const sessionId = req.body.session_id;
    console.log("Session ID from Multer filename:", sessionId);
    cb(null, `audio_file_${sessionId}.wav`);
  },
});

const upload = multer({ storage }).fields([
  { name: "file", maxCount: 1 }, // File field
  { name: "session_id" }, // Form fields
  { name: "max_speakers" },
  { name: "bot_id" },
]);

//test endpoint
app.get("/test", (req, res) => {
  res.send("Hello World");
});

//endpoint to handle image upload

// Endpoint to handle audio file upload
// app.post("/upload/audio", upload, (req, res) => {
//   // Ensure the field name matches the client
//   // const audioFilePath = req.file.path;
//   const fileField = req.files?.file;
//   if (!fileField || fileField.length === 0) {
//     return res.status(400).send("No file uploaded");
//   }

//   const audioFilePath = fileField[0].path; // File path
//   console.log("Audio file path:", audioFilePath);
//   const sessionId = req.body.session_id; // Declare sessionId once

//   const outputDir = path.join(__dirname, `output/session_${sessionId}`);
//   const maxSpeakers = req.body.max_speakers;
//   const botId = req.body.bot_id;
//   console.log(sessionId + " max speakers: " + maxSpeakers);
//   console.log("--------------------------------");
//   console.log("Bot ID: " + req.body.bot_id);
//   console.log("--------------------------------");
//   // Create the output directory if it doesn't exist
//   fs.access(outputDir, fs.constants.W_OK, (err) => {
//     if (err) {
//       fs.mkdirSync(outputDir, { recursive: true });
//     }

//     // Construct the WhisperX CLI command
//     const command = "bash";
//     const args = [
//       "-c",
//       `source /Users/s.m.ahadalichowdhury/Downloads/project/whisper/whisperx_env/bin/activate && whisperx ${audioFilePath} --compute_type int8 --diarize --max_speakers ${maxSpeakers} --hf_token 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`,
//     ];

//     // Set the environment variable to force float32 precision
//     const env = { ...process.env, TORCH_DTYPE: "float32" };

//     // Execute the command
//     const childProcess = spawn(command, args, { env });

//     childProcess.stdout.on("data", (data) => {
//       console.log(`WhisperX output: ${data}`);
//     });

//     childProcess.stderr.on("data", (data) => {
//       console.warn(`WhisperX stderr: ${data}`);
//     });

//     childProcess.on("error", (err) => {
//       console.error(`Failed to start subprocess: ${err.message}`);
//       return res.status(500).send("Error processing audio file.");
//     });

//     childProcess.on("close", (code) => {
//       if (code !== 0) {
//         console.error(`WhisperX process exited with code ${code}`);
//         return res.status(500).send("Error processing audio file.");
//       }
//       console.log("WhisperX process completed successfully.");

//       // Move all files starting with "audio" from the root project folder to the relevant output session folder
//       const files = fs.readdirSync(__dirname);
//       files.forEach((file) => {
//         if (file.startsWith("audio")) {
//           const oldPath = path.join(__dirname, file);
//           const newFileName = file.replace("audio", "transcription");
//           const newPath = path.join(outputDir, newFileName);
//           fs.renameSync(oldPath, newPath);
//         }
//       });

//       // Find the .srt file in the output directory
//       const outputFiles = fs.readdirSync(outputDir);
//       const srtFile = outputFiles.find((file) => file.endsWith(".srt"));

//       if (!srtFile) {
//         console.error("No .srt file found in the output directory.");
//         return res.status(500).send("Error processing audio file.");
//       }

//       const srtFilePath = path.join(outputDir, srtFile);
//       const convertedTxtFilePath = path.join(
//         outputDir,
//         srtFile.replace(".srt", "_converted.txt"),
//       );

//       fs.readFile(srtFilePath, "utf8", (err, data) => {
//         if (err) {
//           console.error(`Failed to read .srt file: ${err.message}`);
//           return res.status(500).send("Error processing audio file.");
//         }

//         // Write the content to the converted .txt file
//         fs.writeFile(convertedTxtFilePath, data, "utf8", (err) => {
//           if (err) {
//             console.error(
//               `Failed to write converted .txt file: ${err.message}`,
//             );
//             return res.status(500).send("Error processing audio file.");
//           }

//           console.log(".srt file converted to .txt file successfully.");

//           // Log session completion
//           console.log(`${sessionId} is complete.`);

//           // Ensure sessionId is defined before constructing the file paths
//           if (!sessionId) {
//             console.error("Session ID is missing!");
//             return res.status(400).send("Session ID is required.");
//           }

//           // Log file paths for the next API call
//           const transcriptionFilePath = path.join(
//             outputDir,
//             `transcription_file_${sessionId}_converted.txt`,
//           );
//           const imageUrlFilePath = path.join(
//             __dirname,
//             `images/${sessionId}/image_urls_${sessionId}.txt`,
//           );
//           console.log(`Transcription file: ${transcriptionFilePath}`);
//           console.log(`Image URL file: ${imageUrlFilePath}`);

//           // Read and encode files to base64
//           try {
//             const transcriptionFile = fs.readFileSync(
//               transcriptionFilePath,
//               "utf8",
//             );
//             const imageUrlFile = fs.readFileSync(imageUrlFilePath, "utf8");

//             const transcriptionFileBase64 =
//               Buffer.from(transcriptionFile).toString("base64");
//             const imageUrlFileBase64 =
//               Buffer.from(imageUrlFile).toString("base64");

//             // Prepare the request body
//             const requestBody = {
//               transcription_file: {
//                 filename: path.basename(transcriptionFilePath),
//                 contents: transcriptionFileBase64,
//               },
//               image_url_file: {
//                 filename: path.basename(imageUrlFilePath),
//                 contents: imageUrlFileBase64,
//               },
//               bot_id: botId,
//             };

//             // Send the POST request
//             axios
//               .post(
//                 "https://api.ohanapay.app/api/1.1/wf/transcribe_session",
//                 requestBody,
//               )
//               .then((response) => {
//                 console.log("Files sent successfully:", response.data);
//                 res.send("Audio file processed and converted successfully.");
//               })
//               .catch((error) => {
//                 console.error("Error sending files to API:", error.message);
//                 res.status(500).send("Error sending files to API.");
//               });
//           } catch (error) {
//             console.error("Error reading files:", error.message);
//             res.status(500).send("Error reading files.");
//           }
//         });
//       });
//     });
//   });
// });
app.post("/upload/audio", upload, async (req, res) => {
  try {
    const fileField = req.files?.file;
    if (!fileField || fileField.length === 0) {
      return res.status(400).send("No file uploaded");
    }

    const audioFilePath = fileField[0].path;
    const sessionId = req.body.session_id;
    const maxSpeakers = req.body.max_speakers;
    const botId = req.body.bot_id;

    console.log(`Session ID: ${sessionId}`);
    console.log(`Max Speakers: ${maxSpeakers}`);
    console.log(`Bot ID: ${botId}`);

    if (!sessionId || !maxSpeakers || !botId) {
      return res
        .status(400)
        .send("Missing required fields: session_id, max_speakers, bot_id");
    }

    const outputDir = path.join(__dirname, `output/session_${sessionId}`);
    fs.mkdirSync(outputDir, { recursive: true });

    // Construct WhisperX command
    const command = "bash";
    const args = [
      "-c",
      `source /Users/s.m.ahadalichowdhury/Downloads/project/whisper/whisperx_env/bin/activate && whisperx ${audioFilePath} --compute_type int8 --diarize --max_speakers ${maxSpeakers} --hf_token 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`,
    ];

    const env = { ...process.env, TORCH_DTYPE: "float32" };
    const childProcess = spawn(command, args, { env });

    childProcess.stdout.on("data", (data) => {
      console.log(`WhisperX output: ${data}`);
    });

    childProcess.stderr.on("data", (data) => {
      console.warn(`WhisperX stderr: ${data}`);
    });

    childProcess.on("error", (err) => {
      console.error(`Failed to start subprocess: ${err.message}`);
      return res.status(500).send("Error processing audio file.");
    });

    childProcess.on("close", async (code) => {
      if (code !== 0) {
        console.error(`WhisperX process exited with code ${code}`);
        return res.status(500).send("Error processing audio file.");
      }
      console.log("WhisperX process completed successfully.");

      // Move files starting with "audio" to output directory
      const files = fs.readdirSync(__dirname);
      files.forEach((file) => {
        if (file.startsWith("audio")) {
          const oldPath = path.join(__dirname, file);
          const newFileName = file.replace("audio", "transcription");
          const newPath = path.join(outputDir, newFileName);
          fs.renameSync(oldPath, newPath);
        }
      });

      // Convert .srt to .txt
      const outputFiles = fs.readdirSync(outputDir);
      const srtFile = outputFiles.find((file) => file.endsWith(".srt"));

      if (!srtFile) {
        console.error("No .srt file found in the output directory.");
        return res.status(500).send("Error processing audio file.");
      }

      const srtFilePath = path.join(outputDir, srtFile);
      const convertedTxtFilePath = path.join(
        outputDir,
        srtFile.replace(".srt", "_converted.txt")
      );

      const data = fs.readFileSync(srtFilePath, "utf8");
      fs.writeFileSync(convertedTxtFilePath, data, "utf8");
      console.log(".srt file converted to .txt file successfully.");

      const transcriptionFilePath = path.join(
        outputDir,
        `transcription_file_${sessionId}_converted.txt`
      );
      const imageUrlFilePath = path.join(
        __dirname,
        `images/${sessionId}/image_urls_${sessionId}.txt`
      );

      if (!fs.existsSync(imageUrlFilePath)) {
        console.warn("Image URL file not found. Skipping upload.");
      }

      console.log(`Transcription file: ${transcriptionFilePath}`);
      console.log(`Image URL file: ${imageUrlFilePath}`);

      // Fetch external data for vector store ID
      const externalApiUrl = `${process.env.EXTERNAL_BACKEND_URL}/bots/get-bot-outside/${botId}`;
      const fetchResponse = await fetch(externalApiUrl);
      if (!fetchResponse.ok) {
        throw new Error(
          `Failed to fetch data from external API: ${fetchResponse.statusText}`
        );
      }

      const externalData = await fetchResponse.json();
      const vectorStoreId = externalData?.data?.vector_store_id;
      if (!vectorStoreId) {
        throw new Error("Vector Store ID is missing in external data.");
      }

      // Upload files to OpenAI
      const filesToUpload = [transcriptionFilePath, imageUrlFilePath];
      const uploadedFiles = await Promise.all(
        filesToUpload
          .filter((filePath) => fs.existsSync(filePath)) // Ensure file exists
          .map((filePath) =>
            uploadToOpenAI(vectorStoreId, filePath, botId)
          )
      );

      console.log("Files uploaded successfully:", uploadedFiles);

      // Final API call with transcription and image data
      const transcriptionFileBase64 = fs
        .readFileSync(transcriptionFilePath, "utf8")
        .toString("base64");

      const imageUrlFileBase64 = fs.existsSync(imageUrlFilePath)
        ? fs.readFileSync(imageUrlFilePath, "utf8").toString("base64")
        : "";

      const requestBody = {
        transcription_file: {
          filename: path.basename(transcriptionFilePath),
          contents: transcriptionFileBase64,
        },
        image_url_file: imageUrlFileBase64
          ? {
              filename: path.basename(imageUrlFilePath),
              contents: imageUrlFileBase64,
            }
          : null,
        bot_id: botId,
      };

      const apiResponse = await axios.post(
        "https://api.ohanapay.app/api/1.1/wf/transcribe_session",
        requestBody
      );

      console.log("Files sent successfully:", apiResponse.data);
      res.send("Audio file processed and converted successfully.");
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send("An error occurred.");
  }
});

// Set up multer for image uploads
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.session_id; // Use sessionId from the request body
    // console.log("image storage session id: ", sessionId);
    const uploadPath = path.join(__dirname, `images/${sessionId}`);
    // console.log("image storage upload path: ", uploadPath);
    fs.access(uploadPath, fs.constants.W_OK, (err) => {
      if (err) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    });
  },
  filename: (req, file, cb) => {
    // const sessionId = req.body.session_id; // Use sessionId from the request body
    // const currentTime = req.body.current_time; // Use current_time from the request body
    // console.log("image upload session id: ", sessionId);
    // console.log("image upload current time: ", currentTime);
    // cb(
    //   null,
    //   `image_${sessionId}_${currentTime}${path.extname(file.originalname)}`,
    // );
    const uniqueFilename = `${Date.now()}_${file.originalname}`;
    cb(null, uniqueFilename);
  },
});
const imageUpload = multer({ storage: imageStorage }).fields([
  { name: "file" }, // File field
  { name: "session_id" }, // Form fields
  { name: "current_time" },
  { name: "bot_id" },
]);

// Serve static files from the 'uploads' directory
app.use("/images", express.static(path.join(__dirname, "images")));

// app.post("/upload/image", imageUpload, (req, res) => {
//   // Check if files are uploaded
//   const fileField = req.files?.file;
//   if (!fileField || fileField.length === 0) {
//     return res.status(400).send("No file uploaded");
//   }

//   const uploadedFile = fileField[0]; // Get the first uploaded file
//   const imageFilePath = uploadedFile.path; // File path of the uploaded image
//   const sessionId = req.body.session_id; // Ensure session ID is available

//   // Construct the image URL
//   const imageUrl = `https://transcribe.ohanapal.bot/images/${sessionId}/${uploadedFile.filename}`;
//   const imageUrlsFilePath = path.join(
//     __dirname,
//     `images/${sessionId}/image_urls_${sessionId}.txt`,
//   );

//   console.log(`Image uploaded for session: ${sessionId}`);
//   console.log(`Image URL: ${imageUrl}`);

//   // Append the image URL to the text file
//   fs.appendFile(imageUrlsFilePath, `${imageUrl}\n`, (err) => {
//     if (err) {
//       console.error(`Failed to write image URL to file: ${err.message}`);
//       return res.status(500).send("Error saving image URL.");
//     }
//     res.send("Image file uploaded successfully.");
//   });
// });

app.post("/upload/image", imageUpload, (req, res) => {
  const fileFields = req.files; // Multer populates this
  
  if (!fileFields || !fileFields.file || fileFields.file.length === 0) {
    return res.status(400).send("No files uploaded");
  }

  const sessionId = req.body.session_id; // Session ID
  if (!sessionId) {
    return res.status(400).send("Session ID is required");
  }

  const imageUrls = [];
  const sessionDirPath = path.join(__dirname, "images", sessionId);
  const imageUrlsFilePath = path.join(
    sessionDirPath,
    `image_urls_${sessionId}.txt`,
  );

  // Process each uploaded file
  fileFields.file.forEach((uploadedFile) => {
    const imageUrl = `https://transcribe.ohanapal.bot/images/${sessionId}/${uploadedFile.filename}`;
    imageUrls.push(imageUrl);
    console.log("image url from loops", imageUrl);

    console.log(`Image saved: ${uploadedFile.filename}`);
    console.log(`Image URL: ${imageUrl}`);
  });

  // Append the image URLs to the text file
  fs.appendFile(imageUrlsFilePath, imageUrls.join("\n") + "\n", (err) => {
    if (err) {
      console.error(`Failed to write image URLs to file: ${err.message}`);
      return res.status(500).send("Error saving image URLs.");
    }
    res.send({
      message: "Image files uploaded successfully.",
      imageUrls,
    });
  });
});


// * Logger middleware
app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(
      req.method,
      req.hostname,
      req.path,
      res.statusCode,
      res.statusMessage,
      new Date(Date.now()),
    );
  });
  next();
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

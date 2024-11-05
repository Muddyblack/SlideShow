import { google } from 'googleapis';
import fs from 'fs-extra';
import path from 'path';
import { Logger } from '../utils/logger.js';
import { config } from '../../../config/config.js';
import { isValidFile } from '../utils/fileValidator.js';

/**
 * Service for managing Google Drive interactions and file synchronization
 * @class
 * @description Handles authentication, file listing, downloading, and sync with Google Drive
 */
export class GoogleDriveService {
    /**
   * Creates a new GoogleDriveService instance
   * @constructor
   */
    constructor() {
      this.logger = new Logger('GoogleDriveService');
      this.downloadPath = path.join(process.cwd(), config.paths.downloadPath);
      this.syncInterval = null;
      this.initialized = false;
      this.isPaused = false;
    }
  


    async initialize() {
      try {
          const auth = new google.auth.GoogleAuth({
              keyFile: config.google.serviceAccountPath,
              scopes: [config.google.scopes]
          });
  
          this.drive = google.drive({ version: config.google.apiVersion, auth });
          
          // Test connection
          await this.drive.files.list({
              pageSize: 1,
          });
  
          await fs.ensureDir(this.downloadPath);
          this.logger.info('Google Drive service initialized successfully');
          this.initialized = true;
      } catch (error) {
          this.logger.error('Failed to initialize Google Drive service:', error);
          throw new Error(`Drive initialization failed: ${error.message}`);
      }
  }

  isInitialized() {
    return this.initialized;
  }

    /**
   * Starts periodic file synchronization with Google Drive
   * @async
   * @param {number} [interval=config.sync.interval] - Sync interval in milliseconds
   * @returns {Promise<void>}
   */
    async startSync(interval = config.sync.interval) {
      // Clear any existing interval first
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
        this.syncInterval = null;
      }
  
      if (this.isPaused) {
        this.logger.info('Service is paused, not starting sync');
        return;
      }
  
      this.syncInterval = setInterval(async () => {
        if (!this.isPaused) {
          try {
            await this.syncFiles();
          } catch (error) {
            this.logger.error('Sync failed:', error);
          }
        }
      }, interval);
  
      // Initial sync
      if (!this.isPaused) {
        await this.syncFiles();
      }
    }

    /**
   * Synchronizes files between Google Drive and local storage
   * @async
   * @throws {Error} If sync operation fails
   * @returns {Promise<Array<Object>>} List of synchronized files
   */
    async syncFiles() {
      const MAX_RETRIES = 3;
      let attempt = 0;
  
      while (attempt < MAX_RETRIES) {
          try {
              const files = await this.listFiles();
              this.logger.info(`Found ${files.length} valid files in Google Drive`);
  
              const localFiles = await fs.readdir(this.downloadPath);
  
              // Download new files with improved error handling
              for (const file of files) {
                  const localPath = path.join(this.downloadPath, file.name);
                  
                  try {
                      if (await fs.pathExists(localPath)) {
                          continue;
                      }
                      await this.downloadFile(file.id, localPath);
                      this.logger.info(`Downloaded: ${file.name}`);
                  } catch (downloadError) {
                      this.logger.warn(`Failed to download ${file.name}, skipping: ${downloadError.message}`);
                      continue;
                  }
              }
  
              // Remove local files that no longer exist in Drive
              for (const localFile of localFiles) {
                  if (!files.some(file => file.name === localFile)) {
                      const localPath = path.join(this.downloadPath, localFile);
                      try {
                          await fs.remove(localPath);
                          this.logger.info(`Removed local file: ${localFile}`);
                      } catch (removeError) {
                          this.logger.warn(`Failed to remove ${localFile}: ${removeError.message}`);
                      }
                  }
              }
  
              return files;
          } catch (error) {
              attempt++;
              this.logger.warn(`Sync attempt ${attempt} failed: ${error.message}`);
              if (attempt === MAX_RETRIES) {
                  this.logger.error('Max retry attempts reached');
                  throw error;
              }
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
      }
  }

    /**
   * Lists valid files from Google Drive
   * @async
   * @returns {Promise<Array<Object>>} Array of file objects
   */
  async listFiles() {
    const files = await this.fetchFilesFromDrive();
    const validFiles = files.filter(file => isValidFile(file.name));
    return validFiles;
  }

    /**
   * Fetches files from a specific Google Drive folder
   * @async
   * @param {string} [folderId=config.google.folderId] - Google Drive folder ID
   * @throws {Error} If fetching files fails
   * @returns {Promise<Array<Object>>} Array of file objects
   */
  async fetchFilesFromDrive(folderId = config.google.folderId) {
    try {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, parents)',
        spaces: 'drive'
      });

      const files = response.data.files;

      // Recursively fetch files from subfolders
      for (const file of files) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          const subfolderFiles = await this.fetchFilesFromDrive(file.id);
          files.push(...subfolderFiles);
        }
      }

      return files;
    } catch (error) {
      this.logger.error('Failed to fetch files from Google Drive:', error);
      throw error;
    }
  }

    /**
   * Downloads a file from Google Drive
   * @async
   * @param {string} fileId - Google Drive file ID
   * @param {string} localPath - Local path to save the file
   * @throws {Error} If download fails
   * @returns {Promise<void>}
   */
  async downloadFile(fileId, localPath) {
    try {
      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );

      const dest = fs.createWriteStream(localPath);
      response.data.pipe(dest);

      return new Promise((resolve, reject) => {
        dest.on('finish', resolve);
        dest.on('error', reject);
      });
    } catch (error) {
      this.logger.error(`Failed to download file ${fileId}:`, error);
      throw error;
    }
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async pause() {
    this.logger.info('Pausing Google Drive service');
    this.isPaused = true;
    this.stop();
  }

  async resume() {
    this.logger.info('Resuming Google Drive service');
    this.isPaused = false;
    await this.startSync(config.sync.interval);
  }
}


//TODO Allow downloading public files without requiring authentication/service account

// import fs from 'fs';
// import https from 'https';
// async function downloadPublicFile(fileId, localPath) {
//   // Google Drive direct download link format
//   const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  
//   return new Promise((resolve, reject) => {
//     const file = fs.createWriteStream(localPath);
    
//     https.get(downloadUrl, (response) => {
//       response.pipe(file);
      
//       file.on('finish', () => {
//         file.close();
//         resolve();
//       });
//     }).on('error', (err) => {
//       fs.unlink(localPath);
//       reject(err);
//     });
//   });
// }
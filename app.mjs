import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import PromiseCrawler from "promise-crawler";
import low from "lowdb";
import Memory from "lowdb/adapters/Memory.js";
import { spawn } from "child_process";
import { dirname } from 'path';

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, "public")));

const crawler = new PromiseCrawler({
  maxConnections: 10,
  retries: 3,
});

const setupDatabase = (fileName) => {
  const adapter = new Memory();
  const db = low(adapter);
  db.defaults({ username: "", movies: [] }).write();
  return db;
};

const scrapeLetterboxd = async (username, db) => {
  const LETTERBOXD_FILMS_BASE = `https://letterboxd.com/${username}/films/`;
  let LETTERBOXD_MAX_PAGES = 0;

  const movies = db.get("movies");
  movies.remove().write(); // Clear existing movies before scraping

  const getLetterboxdPage = ({ page }) =>
    crawler.request({
      url: `${LETTERBOXD_FILMS_BASE}${page > 1 ? `page/${page}/` : ""}`,
    });

  const handleLetterBoxdResponse = ({ $ }) => {
    if (!LETTERBOXD_MAX_PAGES) {
      LETTERBOXD_MAX_PAGES = parseInt($(".paginate-page:last-child").text().trim());
    }

    $(".poster-list > li").each((i, el) => {
      const $li = $(el);
      const $img = $("img.image", $li);
      const $poster = $(".film-poster", $li);
      const $ratingEl = $(".poster-viewingdata > .rating", $li);

      const letterboxdId = parseInt($poster.data("filmId"));

      let letterboxdRating = 0;
      if ($ratingEl.prop("name") !== undefined) {
        const ratingStr = $ratingEl.attr("class");
        letterboxdRating = parseInt(ratingStr.substring(ratingStr.lastIndexOf("-") + 1));
      }
      const title = $img.attr("alt");
      movies.push({
        letterboxdId,
        title,
        letterboxdRating,
      }).write();
    });
  };

  await crawler.setup();

  const res = await getLetterboxdPage({ page: 1 });
  handleLetterBoxdResponse(res);

  let pages = [];

  if (LETTERBOXD_MAX_PAGES > 1) {
    for (let i = 0; i < LETTERBOXD_MAX_PAGES - 1; i++) {
      pages.push(i + 2);
    }
  }

  const responses = await Promise.all(pages.map((pg) => getLetterboxdPage({ page: pg })));

  responses.forEach(handleLetterBoxdResponse);

  process.nextTick(() => {
    crawler.destroy();

    // Instead of writing to a file, we'll keep the data in memory
    const movieData = { username, movies: movies.value() };

    // Start same.js after scraping is completed
    const sameProcess = spawn("node", ["same.js"]);

    // Log the output of same.js
    sameProcess.stdout.on("data", (data) => {
      console.log(`same.js Output: ${data}`);
    });

    // Log any errors that occur in same.js
    sameProcess.stderr.on("data", (data) => {
      console.error(`Error in same.js: ${data}`);
    });

    // Log when same.js exits
    sameProcess.on("close", (code) => {
      console.log(`same.js exited with code ${code}`);
    });
  });

  // Return the movie data
  return { username, movies: movies.value() };
};

app.post("/scrape", async (req, res) => {
  console.log("Received POST request to /scrape");
  const usernames = req.body.usernames;

  console.log("Usernames received:", usernames);

  if (!usernames || usernames.length !== 2) {
    console.log("Invalid usernames provided");
    return res.status(400).json({ error: "Please provide exactly two Letterboxd usernames." });
  }

  const [USERNAME1, USERNAME2] = usernames;

  try {
    console.log("Starting scraping process for", USERNAME1, "and", USERNAME2);

    // Include the Letterboxd scraping logic for USERNAME1
    const db1 = setupDatabase("movies1");
    const scrape1Promise = scrapeLetterboxd(USERNAME1, db1);

    // Include the Letterboxd scraping logic for USERNAME2
    const db2 = setupDatabase("movies2");
    const scrape2Promise = scrapeLetterboxd(USERNAME2, db2);

    // Wait for both scraping processes to complete
    const [data1, data2] = await Promise.all([scrape1Promise, scrape2Promise]);

    console.log("Scraping completed successfully");

    // Process the data (this replaces the functionality in same.js)
    const commonMovies = processCommonMovies(data1, data2);

    // Send the processed data as a response
    res.json({ success: true, message: "Scraping completed", data: commonMovies });
  } catch (error) {
    console.error("Error during scraping:", error);
    res.status(500).json({ error: "An error occurred during scraping: " + error.message });
  }
});

// Add this function to process common movies (replacing same.js functionality)
function processCommonMovies(data1, data2) {
  // Implement the logic to find common movies and calculate similarity
  // This should replicate the functionality from same.js
  // Return the processed data
}

// Add this route before your catch-all route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Your existing catch-all route
app.use('*', (req, res) => {
  console.log('Catch-all route hit:', req.method, req.originalUrl);
  res.status(404).json({ error: 'Route not found', method: req.method, url: req.originalUrl });
});

// Add this condition to handle both local and Vercel environments
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
  });
}

// Add this line at the end of the file
export default app;

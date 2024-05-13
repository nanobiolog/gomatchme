import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import PromiseCrawler from "promise-crawler";
import low from "lowdb";
import FileSync from "lowdb/adapters/FileSync.js";
import { spawn } from "child_process";

const app = express();
const port = process.env.PORT || 8080;


app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public")));

const crawler = new PromiseCrawler({
  maxConnections: 10,
  retries: 3,
});

const setupDatabase = (fileName) => {
  const adapter = new FileSync(fileName);
  const db = low(adapter);
  db.defaults({ username: "", movies: [] }).write();
  return db;
};

const scrapeLetterboxd = async (username, db, fileName) => {
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

    // Write the movie data to the specified JSON file with the username at the top
    fs.writeFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), fileName),
      JSON.stringify({ username, movies: movies.value() })
    );

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
};

app.post("/scrape", async (req, res) => {
  const usernames = req.body.usernames;

  if (!usernames || usernames.length !== 2) {
    return res.status(400).send("Please provide exactly two Letterboxd usernames.");
  }

  const [USERNAME1, USERNAME2] = usernames;

  // Include the Letterboxd scraping logic for USERNAME1
  const db1 = setupDatabase("movies1.json");
  const scrape1Promise = scrapeLetterboxd(USERNAME1, db1, "movies1.json");

  // Include the Letterboxd scraping logic for USERNAME2
  const db2 = setupDatabase("movies2.json");
  const scrape2Promise = scrapeLetterboxd(USERNAME2, db2, "movies2.json");

  // Wait for both files to be written
  await Promise.all([scrape1Promise, scrape2Promise]);

  // Redirect to commonMovies.html
  res.redirect("/commonMovies.html");
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});

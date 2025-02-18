import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import PromiseCrawler from "promise-crawler";
import low from "lowdb";
import Memory from "lowdb/adapters/Memory.js";
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

// Setup in-memory database
const setupDatabase = (fileName) => {
  const adapter = new Memory();
  const db = low(adapter);
  db.defaults({ username: "", movies: [] }).write();
  return db;
};

const scrapeLetterboxd = async (username, db) => {
  try {
    const LETTERBOXD_FILMS_BASE = `https://letterboxd.com/${username}/films/`;
    let LETTERBOXD_MAX_PAGES = 0;

    const movies = db.get("movies");
    movies.remove().write(); // Clear existing movies before scraping

    const getLetterboxdPage = ({ page }) =>
      crawler.request({
        url: `${LETTERBOXD_FILMS_BASE}${page > 1 ? `page/${page}/` : ""}`,
      });

    // Add the handleLetterBoxdResponse function
    const handleLetterBoxdResponse = ({ $ }) => {
      if (!LETTERBOXD_MAX_PAGES) {
        const lastPageElement = $(".paginate-page:last-child");
        if (lastPageElement.length > 0) {
          LETTERBOXD_MAX_PAGES = parseInt(lastPageElement.text().trim()) || 1;
        } else {
          LETTERBOXD_MAX_PAGES = 1; // If no pagination, assume single page
        }
        console.log(`Detected ${LETTERBOXD_MAX_PAGES} total pages for ${username}`);
      }

      let moviesOnPage = 0;
      $(".poster-list > li").each((i, el) => {
        const $li = $(el);
        const $img = $("img.image", $li);
        const $poster = $(".film-poster", $li);
        const $ratingEl = $(".poster-viewingdata > .rating", $li);

        const letterboxdId = parseInt($poster.data("filmId"));
        if (!letterboxdId) {
          console.log(`Warning: Could not parse film ID for a movie on ${username}'s page`);
          return; // Skip this movie
        }

        let letterboxdRating = 0;
        if ($ratingEl.length > 0 && $ratingEl.prop("name") !== undefined) {
          const ratingStr = $ratingEl.attr("class");
          const ratingMatch = ratingStr.match(/rated-(\d+)/);
          if (ratingMatch) {
            letterboxdRating = parseInt(ratingMatch[1]);
          }
        }

        const title = $img.attr("alt");
        if (!title) {
          console.log(`Warning: Could not parse title for movie ID ${letterboxdId} on ${username}'s page`);
          return; // Skip this movie
        }

        movies.push({
          letterboxdId,
          title,
          letterboxdRating,
        }).write();
        moviesOnPage++;
      });

      console.log(`Processed ${moviesOnPage} movies from page for ${username}`);
    };

    console.log(`Setting up crawler for ${username}...`);
    await crawler.setup();
    console.log(`Crawler setup complete for ${username}`);

    console.log(`Fetching first page for ${username}...`);
    const res = await getLetterboxdPage({ page: 1 });
    handleLetterBoxdResponse(res);
    console.log(`First page processed for ${username}`);

    let pages = [];

    if (LETTERBOXD_MAX_PAGES > 1) {
      for (let i = 0; i < LETTERBOXD_MAX_PAGES - 1; i++) {
        pages.push(i + 2);
      }
      console.log(`Found ${LETTERBOXD_MAX_PAGES} pages total for ${username}`);
    }

    if (pages.length > 0) {
      console.log(`Fetching remaining ${pages.length} pages for ${username}...`);
      const responses = await Promise.all(pages.map((pg) => getLetterboxdPage({ page: pg })));
      responses.forEach(handleLetterBoxdResponse);
      console.log(`Processed all ${pages.length} remaining pages for ${username}`);
    }

    console.log(`Scraped ${movies.value().length} movies for user ${username}`);

    // Cleanup crawler
    crawler.destroy();
    console.log(`Crawler destroyed for ${username}`);

    // Return the movie data
    const movieData = { username, movies: movies.value() };
    console.log(`Returning data for ${username} with ${movieData.movies.length} movies`);
    return movieData;
  } catch (error) {
    console.error(`Error scraping data for ${username}:`, error);
    crawler.destroy(); // Ensure crawler is cleaned up even on error
    throw new Error(`Failed to scrape data for ${username}: ${error.message}`);
  }
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
    console.log(`Starting scrape for ${USERNAME1}`);
    const data1 = await scrapeLetterboxd(USERNAME1, db1);
    console.log(`Completed scrape for ${USERNAME1}`);

    // Include the Letterboxd scraping logic for USERNAME2
    const db2 = setupDatabase("movies2");
    console.log(`Starting scrape for ${USERNAME2}`);
    const data2 = await scrapeLetterboxd(USERNAME2, db2);
    console.log(`Completed scrape for ${USERNAME2}`);

    console.log("Both scraping processes completed successfully");

    // Process the data directly
    console.log("Processing common movies...");
    const commonMoviesData = processCommonMovies(data1, data2);
    console.log(`Found ${commonMoviesData.commonMovies.length} common movies with mean similarity ${commonMoviesData.meanSimilarityPercentage.toFixed(2)}%`);

    // Send the processed data as a response
    res.json({ success: true, message: "Scraping completed", data: commonMoviesData });
  } catch (error) {
    console.error("Error during scraping:", error);
    res.status(500).json({ 
      error: "An error occurred during scraping", 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
});

function processCommonMovies(data1, data2) {
  try {
    // Function to calculate similarity as a percentage
    function calculateSimilarityPercentage(ratings1, ratings2) {
      const nonZeroRatings1 = ratings1.filter(rating => rating !== 0);
      const nonZeroRatings2 = ratings2.filter(rating => rating !== 0);

      const n = Math.min(nonZeroRatings1.length, nonZeroRatings2.length);

      if (n === 0) {
        return 0; // No common non-zero rated movies
      }

      const absoluteDifferenceSum = nonZeroRatings1.slice(0, n).reduce((sum, rating1, index) => sum + Math.abs(rating1 - nonZeroRatings2[index]), 0);
      const maxDifferenceSum = n * 10; // Assuming ratings are in the range of 0-10

      return ((maxDifferenceSum - absoluteDifferenceSum) / maxDifferenceSum) * 100;
    }

    console.log(`Processing movies for users ${data1.username} and ${data2.username}`);
    console.log(`User ${data1.username} has ${data1.movies.length} movies`);
    console.log(`User ${data2.username} has ${data2.movies.length} movies`);

    // Separate movies into two arrays: one for common movies with non-zero ratings, and another for movies with at least one zero rating
    const commonMoviesWithNonZeroRating = [];
    const commonMoviesWithZeroRating = [];

    data1.movies.forEach(movie1 => {
      const matchingMovie2 = data2.movies.find(movie2 => movie2.letterboxdId === movie1.letterboxdId);

      if (matchingMovie2) {
        const similarityPercentage = calculateSimilarityPercentage(
          [movie1.letterboxdRating],
          [matchingMovie2.letterboxdRating]
        );

        const commonMovie = {
          letterboxdId: movie1.letterboxdId,
          title: movie1.title,
          ratings: {
            [data1.username]: movie1.letterboxdRating,
            [data2.username]: matchingMovie2.letterboxdRating,
          },
          similarityPercentage: similarityPercentage,
        };

        if (movie1.letterboxdRating !== 0 && matchingMovie2.letterboxdRating !== 0) {
          commonMoviesWithNonZeroRating.push(commonMovie);
        } else {
          commonMoviesWithZeroRating.push(commonMovie);
        }
      }
    });

    console.log(`Found ${commonMoviesWithNonZeroRating.length} common movies with non-zero ratings`);
    console.log(`Found ${commonMoviesWithZeroRating.length} common movies with at least one zero rating`);

    // Calculate mean similarity percentage for movies with non-zero ratings
    const nonZeroCommonMovies = commonMoviesWithNonZeroRating.filter(movie => 
      movie.ratings[data1.username] !== 0 && movie.ratings[data2.username] !== 0
    );
    
    const meanSimilarityPercentage = nonZeroCommonMovies.length > 0 
      ? nonZeroCommonMovies.reduce((sum, movie) => sum + movie.similarityPercentage, 0) / nonZeroCommonMovies.length 
      : 0;

    // Include movies with at least one zero rating in the commonMovies array
    const commonMovies = [...commonMoviesWithNonZeroRating, ...commonMoviesWithZeroRating];

    // Create the final result object
    const commonMoviesObject = { 
      meanSimilarityPercentage, 
      commonMovies,
      stats: {
        user1: {
          username: data1.username,
          totalMovies: data1.movies.length
        },
        user2: {
          username: data2.username,
          totalMovies: data2.movies.length
        },
        commonMoviesCount: commonMovies.length,
        ratedMoviesCount: nonZeroCommonMovies.length
      }
    };

    console.log(`Successfully processed common movies with mean similarity ${meanSimilarityPercentage.toFixed(2)}%`);
    return commonMoviesObject;
  } catch (error) {
    console.error('Error in processCommonMovies:', error);
    throw new Error(`Failed to process common movies: ${error.message}`);
  }
}

// Add this route before your catch-all route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add route to serve commonMovies.html
app.get('/commonMovies.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'commonMovies.html'));
});

// Insert the following new route before the catch-all route
app.get('/api/imdb-poster', async (req, res) => {
  const { title, letterboxdId } = req.query;
  if (!title) {
    return res.status(400).json({ error: 'Missing title parameter' });
  }

  const omdbApiKey = process.env.OMDB_API_KEY || 'YOUR_OMDB_API_KEY';

  try {
    const response = await fetch(`http://www.omdbapi.com/?apikey=${omdbApiKey}&t=${encodeURIComponent(title)}`);
    const data = await response.json();

    if (data.Response === 'False') {
      return res.status(404).json({ error: data.Error || 'Movie not found' });
    }

    return res.json({ poster: data.Poster });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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

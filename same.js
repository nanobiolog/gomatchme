const fs = require('fs');

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

  const similarityPercentage = ((maxDifferenceSum - absoluteDifferenceSum) / maxDifferenceSum) * 100;
  return similarityPercentage;
}

try {
  // Read the content of the JSON files
  const file1Content = fs.readFileSync('movies1.json', 'utf8');
  const file2Content = fs.readFileSync('movies2.json', 'utf8');

  console.log('File 1 Content:', file1Content);
  console.log('File 2 Content:', file2Content);

  // Parse the JSON content
  const data1 = JSON.parse(file1Content);
  const data2 = JSON.parse(file2Content);

  // Check if movies1 and movies2 have a "movies" array and a "username" property
  if (!Array.isArray(data1.movies) || !Array.isArray(data2.movies) || !data1.username || !data2.username) {
    throw new Error('Failed to parse JSON files');
  }

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

  // Calculate mean similarity percentage for movies with non-zero ratings
  const nonZeroCommonMovies = commonMoviesWithNonZeroRating.filter(movie => movie.ratings[data1.username] !== 0 && movie.ratings[data2.username] !== 0);
  const meanSimilarityPercentage = nonZeroCommonMovies.reduce((sum, movie) => sum + movie.similarityPercentage, 0) / nonZeroCommonMovies.length;

  // Include movies with at least one zero rating in the commonMovies array
  const commonMovies = [...nonZeroCommonMovies, ...commonMoviesWithZeroRating];

  // Create a new JSON object with mean similarity percentage and common movies
  const commonMoviesObject = { meanSimilarityPercentage, commonMovies };

  // Convert the object to JSON string
  const commonMoviesJSON = JSON.stringify(commonMoviesObject, null, 2);

  // Write the common movies to a new JSON file
  fs.writeFileSync('public/commonMovies.json', commonMoviesJSON);

  console.log('Common Movies:', commonMovies);
  console.log('Common Movies saved to commonMovies.json');
} catch (error) {
  console.error('Error:', error.message);
}

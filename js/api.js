/**
 * Open Trivia DB API Service Module.
 * Isolates all interactions with the Open Trivia DB API, including data fetching,
 * HTML entity decoding, option shuffling, and response formatting.
 */

// Helper to decode HTML entities using the browser's DOM parser
function decodeHTMLEntities(text) {
  if (!text) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

// Fisher-Yates shuffle implementation to shuffle array in place
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Fetch list of trivia categories from Open Trivia DB.
 * Returns a promise resolving to an array of { id, name }.
 */
export async function fetchCategories() {
  try {
    const response = await fetch('https://opentdb.com/api_category.php');
    if (!response.ok) {
      throw new Error(`Failed to fetch categories: ${response.statusText}`);
    }
    const data = await response.json();
    return data.trivia_categories || [];
  } catch (error) {
    console.error('Error fetching trivia categories:', error);
    throw error;
  }
}

/**
 * Fetch questions from the Open Trivia DB API based on user parameters.
 * Automatically handles data parsing, entity decoding, and option shuffling.
 * 
 * @param {Object} params - Search configuration parameters.
 * @param {number} params.amount - Number of questions to retrieve.
 * @param {string} [params.category] - Dynamic category ID.
 * @param {string} [params.difficulty] - Easy, medium, or hard.
 * @returns {Promise<Array>} List of formatted question objects.
 */
export async function fetchQuestions({ amount = 10, category = '', difficulty = '' }) {
  let url = `https://opentdb.com/api.php?amount=${amount}&type=multiple`;
  
  if (category) {
    url += `&category=${category}`;
  }
  if (difficulty) {
    url += `&difficulty=${difficulty}`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    const data = await response.json();

    // Check response code from API: 
    // 0 = Success, 1 = No Results, 2 = Invalid Parameter, 3 = Token Not Found, 4 = Token Empty
    if (data.response_code !== 0) {
      throw new Error(`API Error Code: ${data.response_code}. Could not fetch sufficient questions.`);
    }

    // Format results to application schema
    return data.results.map((raw) => {
      const decodedQuestion = decodeHTMLEntities(raw.question);
      const decodedCorrect = decodeHTMLEntities(raw.correct_answer);
      const decodedIncorrects = raw.incorrect_answers.map(ans => decodeHTMLEntities(ans));
      
      // Combine and shuffle options
      const rawOptions = [decodedCorrect, ...decodedIncorrects];
      const shuffledOptions = shuffleArray(rawOptions);
      
      // Locate the index of the correct answer in shuffled array
      const correctAnswerIndex = shuffledOptions.indexOf(decodedCorrect);

      return {
        question: decodedQuestion,
        options: shuffledOptions,
        correctAnswer: correctAnswerIndex
      };
    });
  } catch (error) {
    console.error('Error fetching questions from API:', error);
    throw error;
  }
}

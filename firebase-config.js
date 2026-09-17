const firebaseConfig = {
  apiKey: "AIzaSyCT3y4Y1A4ruL-3MLiAvyCYWsJXh88VO5o",
  authDomain: "asddsa-b2667.firebaseapp.com",
  databaseURL: "https://asddsa-b2667-default-rtdb.firebaseio.com",
  projectId: "asddsa-b2667",
  storageBucket: "asddsa-b2667.firebasestorage.app",
  messagingSenderId: "176270662640",
  appId: "1:176270662640:web:ce66d19040b00befb81b35"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

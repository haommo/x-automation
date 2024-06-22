const fs = require("fs-extra");
const path = require("path");
const Excel = require("exceljs");
const puppeteer = require("puppeteer-extra");
const UserDataDirPlugin = require("puppeteer-extra-plugin-user-data-dir")();
const StealthPlugin = require("puppeteer-extra-plugin-stealth")();
const proxyChain = require("proxy-chain");
const axios = require("axios");
const OpenAI = require("openai");

puppeteer.use(UserDataDirPlugin);
puppeteer.use(StealthPlugin);

const settingsPath = path.join(__dirname, "..", "data", "settings.json");
const profilesPath = path.join(__dirname, "..", "data", "profiles.json");
const userDataDir = path.join(__dirname, "..", "user-data");

let browsers = {}; 
let stopAutomation = false; 
let totalProfiles = 0; 
let successfulProfiles = 0; 

let results = {}; 

document.addEventListener("DOMContentLoaded", async () => {
  document
    .getElementById("saveSettings")
    .addEventListener("click", saveSettings);
  document
    .getElementById("importButton")
    .addEventListener("click", importExcelProfiles);
  document
    .getElementById("startButton")
    .addEventListener("click", startAutomation);
  document
    .getElementById("stopButton")
    .addEventListener("click", stopAllProfiles);
  await loadSettings();
  await loadProfiles();
});


function showAlert(message, type, duration = 3000) {
  const alertPlaceholder = document.createElement("div");
  alertPlaceholder.className = `alert alert-${type} alert-top`;
  alertPlaceholder.innerText = message;
  document.body.appendChild(alertPlaceholder);
  setTimeout(() => {
    alertPlaceholder.remove();
  }, duration);
}


function saveSettings() {
  const settings = {
    linkPost: document.getElementById("linkPost").value,
    minTime: parseInt(document.getElementById("minTime").value),
    maxTime: parseInt(document.getElementById("maxTime").value),
    numThreads: parseInt(document.getElementById("numThreads").value),
    chromePath: document.getElementById("chromePath").value,
  };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  showAlert("Lưu cài đặt thành công", "success");
  console.log("Đã lưu cài đặt vào:", settingsPath);
}


async function loadSettings() {
  try {
    const data = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(data);
    document.getElementById("linkPost").value = settings.linkPost;
    document.getElementById("minTime").value = settings.minTime;
    document.getElementById("maxTime").value = settings.maxTime;
    document.getElementById("numThreads").value = settings.numThreads;
    document.getElementById("chromePath").value = settings.chromePath;
    console.log("Đã tải cài đặt từ:", settingsPath);
  } catch (error) {
    console.error("Lỗi tải cài đặt:", error);
    showAlert("Lỗi tải cài đặt", "danger");
  }
}


async function updateProfileStatus(profileName, status) {
  let profiles = JSON.parse(await fs.readFile(profilesPath, "utf-8"));
  const profile = profiles.find((p) => p.name === profileName);
  if (profile) {
    profile.status = status;
    await fs.writeFile(profilesPath, JSON.stringify(profiles, null, 2));
    console.log(
      `Cập nhật trạng thái của profile ${profileName} thành ${status}`
    );
  }
}


async function openProfile(profileName) {
  let profiles = JSON.parse(await fs.readFile(profilesPath, "utf-8"));
  const profile = profiles.find((p) => p.name === profileName);
  if (profile) {
    console.log(`Mở profile: ${profile.name}`);
    const [proxyHost, proxyPort, proxyUser, proxyPass] =
      profile.proxy.split(":");
    const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;
    const anonymizedProxy = await proxyChain.anonymizeProxy(proxyUrl);

    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      const browser = await puppeteer.launch({
        headless: false,
        userDataDir: profile.userData,
        executablePath: settings.chromePath,
        args: [`--proxy-server=${anonymizedProxy}`],
      });
      const page = await browser.newPage();
      await page.goto("https://x.com");

      browsers[profileName] = browser;

      browser.on("disconnected", () => {
        closeProfileManually(profileName);
      });

      await updateProfileStatus(profileName, "open");
      loadProfiles(); 
    } catch (error) {
      console.error("Lỗi khi mở profile:", error);
    }
  }
}


async function closeProfile(profileName) {
  let profiles = JSON.parse(await fs.readFile(profilesPath, "utf-8"));
  const profile = profiles.find((p) => p.name === profileName);
  if (profile && browsers[profileName]) {
    try {
      await browsers[profileName].close();
      delete browsers[profileName];

      await updateProfileStatus(profileName, "closed");
      loadProfiles(); 
      showAlert(`Profile ${profileName} đã đóng thành công`, "success");
    } catch (error) {
      console.error("Lỗi khi đóng profile:", error);
    }
  }
}

function closeProfileManually(profileName) {
  let profiles = JSON.parse(fs.readFileSync(profilesPath));
  const profile = profiles.find((p) => p.name === profileName);
  if (profile) {
    profile.status = "closed";
    fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
    loadProfiles();
    showAlert(`Profile ${profileName} đã bị đóng thủ công`, "warning");
  }
}


function deleteProfile(profileName, userDataDir) {
  console.log(`Thử xóa profile: ${profileName}`);
  let profiles = JSON.parse(fs.readFileSync(profilesPath));
  profiles = profiles.filter((p) => p.name !== profileName);
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
  console.log(
    `Đã cập nhật profiles.json: ${JSON.stringify(profiles, null, 2)}`
  );

  const table = document.getElementById("profileTable");
  let rowDeleted = false;
  for (let i = 0, row; (row = table.rows[i]); i++) {
    if (row.cells[1].innerText === profileName) {
      table.deleteRow(i);
      rowDeleted = true;
      break;
    }
  }
  if (rowDeleted) {
    console.log(`Đã xóa hàng profile từ bảng.`);
  } else {
    console.log(`Không tìm thấy hàng profile trong bảng.`);
  }

  deleteUserDataDir(userDataDir);
  showAlert(`Profile ${profileName} đã xóa thành công`, "success");
  console.log(`Profile ${profileName} đã bị xóa.`);
}


function deleteUserDataDir(dir) {
  const decodedDir = decodeURIComponent(dir);
  if (fs.existsSync(decodedDir)) {
    fs.rmSync(decodedDir, { recursive: true, force: true });
    console.log(`Thư mục dữ liệu người dùng ${decodedDir} đã bị xóa.`);
  } else {
    console.log(`Thư mục dữ liệu người dùng ${decodedDir} không tồn tại.`);
  }
}


async function runSingleProfile(profileName) {
  const settings = await loadJSON(settingsPath);
  const profiles = await loadJSON(profilesPath);
  const profile = profiles.find((p) => p.name === profileName);

  if (profile) {
    stopAutomation = true; 
    try {
      await runProfile(profile, settings);
    } catch (error) {
      console.error(`Lỗi khi chạy profile ${profile.name}:`, error);
    }
    stopAutomation = false; 
  } else {
    console.error(`Không tìm thấy profile với tên ${profileName}`);
  }
}


async function runProfile(profile, settings) {
  const { linkPost, minTime, maxTime, chromePath } = settings;
  const [proxyHost, proxyPort, proxyUser, proxyPass] = profile.proxy.split(":");
  const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;
  const anonymizedProxy = await proxyChain.anonymizeProxy(proxyUrl);

  console.log(`Bắt đầu profile: ${profile.name}`);
  createUserDataDir(profile.userData);
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: profile.userData,
    executablePath: chromePath,
    args: [`--proxy-server=${anonymizedProxy}`],
  });
  browsers[profile.name] = browser;

  const page = await browser.newPage();

  try {
    await navigateToPage(page, "https://x.com/");
    await waitRandomTime(minTime, maxTime);

    const isLoggedIn = await checkLoginStatus(page);
    if (isLoggedIn) {
      await handlePostLogin(page, linkPost, minTime, maxTime, profile);
    } else {
      await performLogin(page, profile);
      const newURL = page.url();
      if (newURL === "https://x.com/home") {
        await handlePostLogin(page, linkPost, minTime, maxTime, profile);
      } else {
        throw new Error("Failure at login");
      }
    }

    if (profile.status !== "Failure at login") {
      results[profile.name] = "Success";
      updateProfileResult(profile.name, "Success");
      successfulProfiles++;
    }
  } catch (error) {
    results[profile.name] = `Error: ${error.message}`;
    updateProfileResult(profile.name, `Error: ${error.message}`);
    throw error;
  } finally {
    await closeBrowser(profile.name);
    updateResultDisplay();
  }
}


async function navigateToPage(page, url) {
  try {
    console.log(`Điều hướng đến: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (error) {
    console.error(`Lỗi khi điều hướng đến ${url}:`, error);
    throw new Error("Error at navigateToPage");
  }
}


async function waitRandomTime(minTime, maxTime) {
  const waitTime =
    Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
  console.log(`Nghỉ ${waitTime} giây`);
  await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
}


async function checkLoginStatus(page) {
  try {
    const isLoggedIn = await page.evaluate(() => {
      return !document.querySelector('a[data-testid="loginButton"]');
    });
    console.log(`Đã đăng nhập: ${isLoggedIn}`);
    return isLoggedIn;
  } catch (error) {
    console.error("Lỗi khi kiểm tra trạng thái đăng nhập:", error);
    throw new Error("Error at checkLoginStatus");
  }
}


async function handlePostLogin(page, linkPost, minTime, maxTime, profile) {
  try {
    await navigateToPage(page, linkPost);
    const postContent = await getPostContent(page);
    if (!postContent) {
      throw new Error("Failure at finding post content");
    }

    const replyText = await getReplyTextFromOpenAI(profile.apiKey, postContent);
    await waitRandomTime(minTime, maxTime);
    await enterReplyText(page, replyText);
    await waitRandomTime(minTime, maxTime);
    const tweetSuccess = await clickTweetButton(page);
    if (!tweetSuccess) {
      throw new Error("Failure at tweeting");
    }

    await waitRandomTime(minTime, maxTime);
  } catch (error) {
    console.error(
      `Lỗi trong quá trình xử lý sau khi đăng nhập cho profile ${profile.name}:`,
      error
    );
    profile.status = `Error: ${error.message}`;
    updateProfileResult(profile.name, `Error: ${error.message}`);
    throw error;
  }
}


async function getPostContent(page) {
  try {
    await page.waitForSelector('div[data-testid="tweetText"]');
    const postContent = await page.$eval(
      'div[data-testid="tweetText"]',
      (element) => element.textContent
    );
    console.log(`Lấy nội dung hoàn thành: ${postContent}`);
    return postContent;
  } catch (error) {
    console.error("Lỗi khi lấy nội dung bài viết:", error);
    throw new Error("Error at getPostContent");
  }
}

async function getReplyTextFromOpenAI(apiKey, postContent) {
  try {
    const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    const response = await openai.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `pretend to be a random social network user, create a comment for this content: ${postContent}. Request from 5 words to 15 words suitable for the content, no hashtag, no emoji, no tag, use the same language as the content. The answer can not be the same as what created`,
        },
      ],
      model: "gpt-3.5-turbo",
    });
    const replyText = response.choices[0].message.content.trim();
    console.log(`Phản hồi ChatGPT: ${replyText}`);
    return replyText;
  } catch (error) {
    console.error("Lỗi khi lấy nội dung trả lời từ OpenAI:", error);
    throw new Error("Error at getReplyTextFromOpenAI");
  }
}


async function enterReplyText(page, replyText) {
  try {
    await page.click(
      "div.public-DraftStyleDefault-block.public-DraftStyleDefault-ltr"
    );
    for (const char of replyText) {
      await page.keyboard.type(char);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error("Lỗi khi nhập nội dung trả lời:", error);
    throw new Error("Error at enterReplyText");
  }
}


async function clickTweetButton(page) {
  try {
    let tweetSuccess = false;
    const tweetRequestPromise = new Promise((resolve) => {
      page.on("request", (request) => {
        if (
          request
            .url()
            .includes(
              "https://x.com/i/api/graphql/oB-5XsHNAbjvARJEc8CZFw/CreateTweet"
            )
        ) {
          tweetSuccess = true;
          resolve();
        }
      });
    });

    await page.click('button[data-testid="tweetButtonInline"]');
    console.log("Nút tweet đã được nhấn.");
    await tweetRequestPromise;
    await new Promise((resolve) => setTimeout(resolve, 5000));

    return tweetSuccess;
  } catch (error) {
    console.error("Lỗi khi nhấn nút tweet:", error);
    throw new Error("Error at clickTweetButton");
  }
}

async function performLogin(page, profile) {
  try {
    await navigateToPage(page, "https://x.com/i/flow/login");
    await enterUsername(page, profile.username);
    await clickNextButton(page);
    await enterPassword(page, profile.password);
    await clickLoginButton(page);
    await enter2FACode(page, profile.twoFA);
  } catch (error) {
    console.error(
      `Lỗi trong quá trình đăng nhập cho profile ${profile.name}:`,
      error
    );
    profile.status = `Error: ${error.message}`;
    updateProfileResult(profile.name, `Error: ${error.message}`);
    throw error;
  }
}


async function enterUsername(page, username) {
  try {
    await page.waitForSelector('input[autocomplete="username"]', {
      timeout: 10000,
    });
    console.log(`Đã tìm thấy trường nhập username`);
    await page.type('input[autocomplete="username"]', username);
    await waitRandomTime(minTime, maxTime);
  } catch (error) {
    console.error("Lỗi khi nhập username:", error);
    throw new Error("Error at enterUsername");
  }
}


async function clickNextButton(page) {
  try {
    await page.waitForSelector(
      "button.css-175oi2r.r-sdzlij.r-1phboty.r-rs99b7.r-lrvibr.r-ywje51.r-184id4b.r-13qz1uu.r-2yi16.r-1qi8awa.r-3pj75a.r-1loqt21.r-o7ynqc.r-6416eg.r-1ny4l3l",
      { timeout: 10000 }
    );
    console.log(`Đã tìm thấy nút tiếp theo`);
    await page.click(
      "button.css-175oi2r.r-sdzlij.r-1phboty.r-rs99b7.r-lrvibr.r-ywje51.r-184id4b.r-13qz1uu.r-2yi16.r-1qi8awa.r-3pj75a.r-1loqt21.r-o7ynqc.r-6416eg.r-1ny4l3l"
    );
    await waitRandomTime(minTime, maxTime);
  } catch (error) {
    console.error("Lỗi khi nhấn nút tiếp theo:", error);
    throw new Error("Error at clickNextButton");
  }
}


async function enterPassword(page, password) {
  try {
    await page.waitForSelector('input[autocomplete="current-password"]', {
      timeout: 10000,
    });
    console.log(`Đã tìm thấy trường nhập password`);
    await page.type('input[autocomplete="current-password"]', password);
    await waitRandomTime(minTime, maxTime);
  } catch (error) {
    console.error("Lỗi khi nhập password:", error);
    throw new Error("Error at enterPassword");
  }
}


async function clickLoginButton(page) {
  try {
    await page.waitForSelector('button[data-testid="LoginForm_Login_Button"]', {
      timeout: 10000,
    });
    console.log(`Đã tìm thấy nút đăng nhập`);
    await page.click('button[data-testid="LoginForm_Login_Button"]');
  } catch (error) {
    console.error("Lỗi khi nhấn nút đăng nhập:", error);
    throw new Error("Error at clickLoginButton");
  }
}


async function enter2FACode(page, twoFA) {
  try {
    await page.waitForSelector('input[data-testid="ocfEnterTextTextInput"]', {
      timeout: 10000,
    });
    console.log(`Đã tìm thấy trường nhập 2FA`);
    const token = await get2FACode(twoFA);
    await page.type('input[data-testid="ocfEnterTextTextInput"]', token);
    await waitRandomTime(minTime, maxTime);
    await page.waitForSelector('button[data-testid="ocfEnterTextNextButton"]', {
      timeout: 10000,
    });
    console.log(`Đã tìm thấy nút tiếp theo 2FA`);
    await page.click('button[data-testid="ocfEnterTextNextButton"]');
    await page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (error) {
    console.error("Lỗi khi nhập mã 2FA:", error);
    throw new Error("Error at enter2FACode");
  }
}


async function get2FACode(twoFA) {
  try {
    const response = await axios.get(`https://2fa.live/tok/${twoFA}`);
    console.log(`Phản hồi API 2FA: ${response.data}`);
    if (response.data && response.data.token) {
      return response.data.token;
    } else {
      throw new Error("Không lấy được mã 2FA");
    }
  } catch (error) {
    console.error("Lỗi khi lấy mã 2FA:", error);
    throw new Error("Error at get2FACode");
  }
}


async function closeBrowser(profileName) {
  if (browsers[profileName]) {
    await browsers[profileName].close();
    delete browsers[profileName];
  }
}


function updateProfileResult(profileName, result) {
  results[profileName] = result;
  const table = document.getElementById("profileTable");
  for (let row of table.rows) {
    if (row.cells[1].innerText === profileName) {
      row.cells[2].innerText = result; // Giả sử cột kết quả ở chỉ số 2
      break;
    }
  }
}


function updateResultDisplay() {
  document.getElementById(
    "result"
  ).value = `${successfulProfiles}/${totalProfiles}`;
}


async function loadJSON(filePath) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Lỗi khi đọc file từ đĩa: ${error}`);
    return null;
  }
}

async function saveProfiles(newProfiles) {
  try {
    const existingProfiles = (await loadJSON(profilesPath)) || [];
    const updatedProfiles = existingProfiles.map((profile) => {
      const newProfile = newProfiles.find((p) => p.name === profile.name);
      return newProfile || profile;
    });
    newProfiles.forEach((profile) => {
      if (!updatedProfiles.find((p) => p.name === profile.name)) {
        updatedProfiles.push(profile);
      }
    });
    await fs.writeFile(profilesPath, JSON.stringify(updatedProfiles, null, 2));
    console.log("Lưu các profile thành công:", updatedProfiles);
  } catch (error) {
    console.error("Lỗi khi lưu các profile:", error);
  }
}


async function loadProfiles() {
  try {
    if (fs.existsSync(profilesPath)) {
      const data = await fs.readFile(profilesPath, "utf-8");
      const profiles = JSON.parse(data);
      totalProfiles = profiles.length;
      successfulProfiles = 0;
      updateResultDisplay();
      const table = document.getElementById("profileTable");
      table.innerHTML = ""; // Xóa bảng hiện tại
      profiles.forEach((profile, index) => addProfileToTable(profile, index));
      console.log("Đã tải các profile từ:", profilesPath);
    } else {
      console.log("Không có profile nào để tải.");
    }
  } catch (error) {
    console.error("Lỗi khi tải các profile:", error);
  }
}

async function importExcelProfiles() {
  const fileInput = document.getElementById("excelFile");
  if (fileInput.files.length === 0) {
    alert("Vui lòng chọn một file Excel để nhập.");
    return;
  }
  const filePath = fileInput.files[0].path;
  const workbook = new Excel.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet(1);

    const table = document.getElementById("profileTable");
    table.innerHTML = "";

    const profiles = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const profileName = generateProfileName();
        const profile = {
          name: profileName,
          proxy: row.getCell(1).value || "",
          username: row.getCell(2).value || "",
          password: row.getCell(3).value || "",
          twoFA: row.getCell(4).value || "",
          apiKey: row.getCell(5).value || "",
          userData: path.join(userDataDir, profileName),
          status: "closed",
        };
        profiles.push(profile);
      }
    });

    profiles.forEach((profile) => {
      addProfileToTable(profile);
      createUserDataDir(profile.userData);
    });

    await saveProfiles(profiles); 
    showAlert(`Đã import profile thành công`, "success");
    console.log("Nhập các profile thành công.");

    await loadProfiles();
  } catch (error) {
    console.error("Lỗi khi đọc file Excel:", error);
  }
}


function generateProfileName() {
  return "profile_" + Math.random().toString(36).substring(2, 15);
}


function createUserDataDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}


function clearProfileResults() {
  const table = document.getElementById("profileTable");
  for (let row of table.rows) {
    row.cells[2].innerText = ""; // Giả sử cột kết quả ở chỉ số 2
  }
}


function addProfileToTable(profile, index) {
  const table = document.getElementById("profileTable");
  const row = table.insertRow();
  const openCloseButton =
    profile.status === "open"
      ? `<button class="btn btn-sm btn-danger" onclick="closeProfile('${profile.name}')">Close</button>`
      : `<button class="btn btn-sm btn-primary" onclick="openProfile('${profile.name}')">Open</button>`;
  const runButton = `<button class="btn btn-sm btn-info" onclick="runSingleProfile('${profile.name}')">Run</button>`;
  row.innerHTML = `
    <td>${index + 1}</td>
    <td>${profile.name}</td>
    <td>${results[profile.name] || ""}</td>
    <td contenteditable="true">${profile.proxy}</td>
    <td contenteditable="true">${profile.username}</td>
    <td contenteditable="true">${profile.password}</td>
    <td contenteditable="true">${profile.twoFA}</td>
    <td contenteditable="true">${profile.apiKey}</td>
    <td>
        ${openCloseButton}
        <button class="btn btn-sm btn-success" onclick="saveProfileFromTable(this)">Save</button>
        <button class="btn btn-sm btn-danger" onclick="deleteProfile('${
          profile.name
        }', '${encodeURIComponent(profile.userData)}')">Delete</button>
        ${runButton}
    </td>
  `;
}


function saveProfileFromTable(button) {
  const row = button.closest("tr");
  const profileName = row.cells[1].innerText;
  let profiles = JSON.parse(fs.readFileSync(profilesPath));
  const profile = profiles.find((p) => p.name === profileName);

  if (profile) {
    profile.proxy = row.cells[3].innerText;
    profile.username = row.cells[4].innerText;
    profile.password = row.cells[5].innerText;
    profile.twoFA = row.cells[6].innerText;
    profile.apiKey = row.cells[7].innerText;

    fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
    showAlert(`Profile ${profileName} đã được cập nhật thành công`, "success");
    console.log(`Profile ${profileName} đã được cập nhật.`);
  } else {
    showAlert(`Cập nhật profile ${profileName} thất bại`, "danger");
  }
}


window.runSingleProfile = runSingleProfile;
window.closeProfile = closeProfile;
window.openProfile = openProfile;
window.saveProfileFromTable = saveProfileFromTable;
window.deleteProfile = deleteProfile;

async function startAutomation() {
  stopAutomation = false;
  const settings = await loadJSON(settingsPath);
  const profiles = await loadJSON(profilesPath);
  const { numThreads, linkPost, minTime, maxTime, chromePath } = settings;

  totalProfiles = profiles.length;
  successfulProfiles = 0;
  updateResultDisplay();

  clearProfileResults();

  for (let i = 0; i < profiles.length; i += numThreads) {
    if (stopAutomation) break;

    const batch = profiles.slice(i, i + numThreads);
    await Promise.all(
      batch.map((profile) =>
        runProfile(profile, { linkPost, minTime, maxTime, chromePath }).catch(
          (err) => {
            console.error(`Lỗi khi chạy profile ${profile.name}:`, err);
          }
        )
      )
    );

    if (stopAutomation) break;
  }

  updateResultDisplay();
}


function stopAllProfiles() {
  stopAutomation = true;
  for (let browser of Object.values(browsers)) {
    browser
      .close()
      .catch((err) => console.error("Lỗi khi đóng trình duyệt:", err));
  }
  browsers = {};
  showAlert("Tất cả profile đã dừng", "info");
}

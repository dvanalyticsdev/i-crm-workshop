import { PUBLIC_COURSES, findCourseById, formatAed, formatInr } from "./course-catalog.js";
import { bindThemeControls, initThemeSystem } from "./theme.js";
import { apiUrl } from "./api-client.js";

initThemeSystem();
bindThemeControls();

const coursesGrid = document.getElementById("coursesGrid");
const courseDetailsModal = document.getElementById("courseDetailsModal");
const courseModalSectionNav = document.getElementById("courseModalSectionNav");
const courseModalSections = document.getElementById("courseModalSections");
const courseModalPrevBtn = document.getElementById("courseModalPrevBtn");
const courseModalNextBtn = document.getElementById("courseModalNextBtn");
const registerModal = document.getElementById("registerModal");
const successModal = document.getElementById("successModal");
const registerForm = document.getElementById("registerForm");
const registerFormMessage = document.getElementById("registerFormMessage");
const submitRegistrationBtn = document.getElementById("submitRegistrationBtn");
let activeCourseId = "";
let activeCourseSectionIndex = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getFakeRating(courseId) {
  let hash = 0;
  for (let i = 0; i < courseId.length; i++) {
    hash = courseId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const rating = (4.6 + (Math.abs(hash) % 4) * 0.1).toFixed(1);
  const reviews = 85 + (Math.abs(hash) % 365);
  return { rating, reviews };
}

function renderStars(rating) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  let starsHtml = "";
  for (let i = 1; i <= 5; i++) {
    if (i <= fullStars) {
      starsHtml += '<span class="star filled">★</span>';
    } else if (i === fullStars + 1 && hasHalf) {
      starsHtml += '<span class="star half">★</span>';
    } else {
      starsHtml += '<span class="star">★</span>';
    }
  }
  return starsHtml;
}

function renderCourses() {
  coursesGrid.innerHTML = PUBLIC_COURSES.map((course) => {
    const { rating, reviews } = getFakeRating(course.id);
    return `
      <article class="course-card" data-course-card="${course.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(course.name)} details">
        <div class="course-card__accent"></div>
        <div class="course-card__poster-wrap">
          <img
            class="course-card__poster"
            src="${escapeHtml(course.poster || "")}"
            alt="${escapeHtml(course.name)} poster"
            loading="lazy"
          />
        </div>
        <div class="course-card__head">
          <span class="course-card__badge">${escapeHtml(course.badge)}</span>
          <span class="course-card__duration">${escapeHtml(course.duration)}</span>
        </div>
        <h2>${escapeHtml(course.name)}</h2>
        <p class="course-card__headline">${escapeHtml(course.headline)}</p>
        <div class="course-card__prices">
          <div>
            <span class="course-card__price-label">INR (incl. 18% GST)</span>
            <strong>${escapeHtml(formatInr(course.price.totalInr))}</strong>
          </div>
          <div>
            <span class="course-card__price-label">AED</span>
            <strong>${escapeHtml(formatAed(course.price.totalAed))}</strong>
          </div>
        </div>
        <div class="course-card__actions">
          <button type="button" class="btn-primary register-course-btn" data-register-course="${course.id}">Register</button>
          <div class="course-card__rating" title="${rating} out of 5 stars based on ${reviews} reviews">
            <div class="course-card__stars">
              ${renderStars(rating)}
            </div>
            <span class="course-card__rating-val">${rating}</span>
            <span class="course-card__reviews">(${reviews})</span>
          </div>
        </div>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-course-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest(".register-course-btn")) {
        return;
      }
      openCourseDetails(card.getAttribute("data-course-card"));
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCourseDetails(card.getAttribute("data-course-card"));
      }
    });
  });

  document.querySelectorAll("[data-register-course]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openRegisterModal(button.getAttribute("data-register-course"));
    });
  });
}

function renderSectionNav(course, activeIndex) {
  const sections = Array.isArray(course.sections) ? course.sections : [];
  courseModalSectionNav.innerHTML = sections
    .map((section, index) => `
      <button
        type="button"
        class="public-modal__nav-btn${index === activeIndex ? " public-modal__nav-btn--active" : ""}"
        data-course-section-index="${index}"
      >
        ${escapeHtml(section.title)}
      </button>
    `)
    .join("");

  document.querySelectorAll("[data-course-section-index]").forEach((button) => {
    button.onclick = () => {
      const nextIndex = Number(button.getAttribute("data-course-section-index"));
      setActiveCourseSection(nextIndex);
    };
  });
}

function renderActiveCourseSection(course, activeIndex) {
  const sections = Array.isArray(course.sections) ? course.sections : [];
  const section = sections[activeIndex];
  if (!section) {
    courseModalSections.innerHTML = "";
    return;
  }

  courseModalSections.innerHTML = `
    <section class="public-modal__section public-modal__section--active">
      <h4>${escapeHtml(section.title)}</h4>
      ${(Array.isArray(section.paragraphs) ? section.paragraphs : [])
        .map((paragraph) => `<p class="public-modal__overview">${escapeHtml(paragraph)}</p>`)
        .join("")}
      ${Array.isArray(section.bullets) && section.bullets.length ? `
        <ul class="public-modal__list">
          ${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
        </ul>
      ` : ""}
    </section>
  `;
}

function syncCourseSectionControls(course, activeIndex) {
  const sections = Array.isArray(course.sections) ? course.sections : [];
  if (courseModalPrevBtn) {
    courseModalPrevBtn.disabled = activeIndex <= 0;
  }
  if (courseModalNextBtn) {
    courseModalNextBtn.disabled = activeIndex >= sections.length - 1;
  }
}

function setActiveCourseSection(nextIndex) {
  const course = findCourseById(activeCourseId);
  if (!course) {
    return;
  }

  const sections = Array.isArray(course.sections) ? course.sections : [];
  const boundedIndex = Math.max(0, Math.min(nextIndex, sections.length - 1));
  activeCourseSectionIndex = boundedIndex;
  renderSectionNav(course, boundedIndex);
  renderActiveCourseSection(course, boundedIndex);
  syncCourseSectionControls(course, boundedIndex);
}

function openCourseDetails(courseId) {
  const course = findCourseById(courseId);
  if (!course) {
    return;
  }

  document.getElementById("courseModalBadge").textContent = course.badge;
  document.getElementById("courseModalTitle").textContent = course.name;
  document.getElementById("courseModalMeta").textContent = `${course.duration} • ${formatInr(course.price.totalInr)} • ${formatAed(course.price.totalAed)}`;
  activeCourseId = course.id;
  activeCourseSectionIndex = 0;
  setActiveCourseSection(0);
  courseDetailsModal.classList.remove("hidden");
}

function closeCourseDetails() {
  courseDetailsModal.classList.add("hidden");
}

function openRegisterModal(courseId) {
  const course = findCourseById(courseId);
  if (!course) {
    return;
  }

  registerForm.reset();
  document.getElementById("registerCourseId").value = course.id;
  document.getElementById("registerModalTitle").textContent = "Register for the Program";
  document.getElementById("registerModalCourse").textContent = course.name;
  registerFormMessage.textContent = "";
  registerFormMessage.style.color = "var(--danger)";
  registerModal.classList.remove("hidden");
}

function closeRegisterModal() {
  registerModal.classList.add("hidden");
}

function openSuccessModal() {
  successModal.classList.remove("hidden");
}

function closeSuccessModal() {
  successModal.classList.add("hidden");
}

function setFormMessage(message, isError = true) {
  registerFormMessage.textContent = message;
  registerFormMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

async function submitRegistration(event) {
  event.preventDefault();

  const course = findCourseById(document.getElementById("registerCourseId").value);
  if (!course) {
    setFormMessage("Select a valid course before submitting.");
    return;
  }

  const payload = {
    courseId: course.id,
    name: document.getElementById("registerName").value.trim(),
    phone: document.getElementById("registerPhone").value.trim(),
    email: document.getElementById("registerEmail").value.trim()
  };

  if (!payload.name || !payload.phone || !payload.email) {
    setFormMessage("Name, phone number, and email address are required.");
    return;
  }

  submitRegistrationBtn.disabled = true;
  setFormMessage("");

  try {
    const response = await fetch(apiUrl("/api/public-course-registrations"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFormMessage(data?.message || "We could not save your registration. Please try again.");
      return;
    }

    if (data?.alreadyRegistered) {
      setFormMessage(data?.message || "You have already registered for this course.", false);
      return;
    }

        closeRegisterModal();
    openSuccessModal();
  } catch {
    setFormMessage("We could not save your registration. Please try again.");
  } finally {
    submitRegistrationBtn.disabled = false;
  }
}

const SUCCESS_STORIES = [
  "WhatsApp Image 2026-06-20 at 12.46.51 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.52 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.52 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.53 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.53 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.53 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.54 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.54 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.55 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.55 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.55 AM (3).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.55 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.56 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.56 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.57 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.57 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.57 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.58 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.58 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.58 AM (3).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.58 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.59 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.59 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.59 AM (3).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.59 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.00 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.00 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.00 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.01 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.01 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.01 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.02 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.02 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.02 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.03 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.03 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.03 AM (3).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.03 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.04 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.04 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.04 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.05 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.05 AM.jpeg"
];

function renderSuccessStories() {
  const track = document.getElementById("successStoriesTrack");
  if (!track) return;

  const imagesHtml = SUCCESS_STORIES.map(img => `
    <div class="success-story-card">
      <img src="Logos/Success Stories/${encodeURIComponent(img)}" alt="Success Story" loading="eager" />
    </div>
  `).join("");

  // Populate two identical sets to ensure seamless infinite scrolling loop
  track.innerHTML = imagesHtml + imagesHtml;
}

document.getElementById("closeCourseModalBtn").onclick = closeCourseDetails;
if (courseModalPrevBtn) {
  courseModalPrevBtn.onclick = () => {
    setActiveCourseSection(activeCourseSectionIndex - 1);
  };
}
if (courseModalNextBtn) {
  courseModalNextBtn.onclick = () => {
    setActiveCourseSection(activeCourseSectionIndex + 1);
  };
}
document.getElementById("closeRegisterModalBtn").onclick = closeRegisterModal;
document.getElementById("cancelRegistrationBtn").onclick = closeRegisterModal;
document.getElementById("closeSuccessModalBtn").onclick = closeSuccessModal;
registerForm.addEventListener("submit", submitRegistration);

[courseDetailsModal, registerModal, successModal].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  });
});

renderCourses();
renderSuccessStories();

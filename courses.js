import { PUBLIC_COURSES, findCourseById, formatAed, formatInr } from "./course-catalog.js";
import { bindThemeControls, initThemeSystem } from "./theme.js";
import { apiUrl } from "./api-client.js";

initThemeSystem();
bindThemeControls();

const coursesGrid = document.getElementById("coursesGrid");
const courseDetailsModal = document.getElementById("courseDetailsModal");
const registerModal = document.getElementById("registerModal");
const successModal = document.getElementById("successModal");
const registerForm = document.getElementById("registerForm");
const registerFormMessage = document.getElementById("registerFormMessage");
const submitRegistrationBtn = document.getElementById("submitRegistrationBtn");
const skillMissionTitle = document.getElementById("skillMissionTitle");
const skillProgressFill = document.getElementById("skillProgressFill");
const skillProgressText = document.getElementById("skillProgressText");
const skillMatchTitle = document.getElementById("skillMatchTitle");
const skillMatchBody = document.getElementById("skillMatchBody");
const skillArchetypeBadges = document.getElementById("skillArchetypeBadges");
const mascotActionDock = document.getElementById("mascotActionDock");

let currentDetailsCourseId = null;
let shouldDownloadAfterRegister = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isCurriculumSection(section) {
  return Array.isArray(section?.curriculumItems) && section.curriculumItems.length > 0;
}

function renderCurriculumSection(section) {
  const introHtml = (Array.isArray(section.paragraphs) ? section.paragraphs : [])
    .map((paragraph) => `<p class="accordion-paragraph">${escapeHtml(paragraph)}</p>`)
    .join("");

  const itemsHtml = section.curriculumItems.map((item, index) => {
    const isOpen = index === 0;
    return `
      <div class="curriculum-card ${isOpen ? "curriculum-card--active" : ""}">
        <button
          type="button"
          class="curriculum-card__trigger"
          aria-expanded="${isOpen ? "true" : "false"}"
          data-curriculum-index="${index}"
        >
          <span class="curriculum-card__title">${escapeHtml(item.title)}</span>
          <span class="curriculum-card__toggle" aria-hidden="true">${isOpen ? "−" : "+"}</span>
        </button>
        <div class="curriculum-card__content" style="${isOpen ? "" : "display: none;"}">
          <div class="curriculum-card__body">
            ${item.summary ? `<p class="curriculum-card__summary">${escapeHtml(item.summary)}</p>` : ""}
            ${Array.isArray(item.topics) && item.topics.length ? `
              <ul class="curriculum-card__topics">
                ${item.topics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join("")}
              </ul>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    ${introHtml}
    <div class="curriculum-cards">
      ${itemsHtml}
    </div>
  `;
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

const COURSE_SKILLS = {
  "apids": ["Python", "SQL Server", "PySpark & SAS", "Power BI", "Statistics", "Machine Learning", "Deep Learning", "Generative AI", "Agentic AI", "Multi-Agent Systems", "MLOps & LLMOps"],
  "apida": ["Python", "SQL Server", "PySpark & SAS", "Excel AI", "Power BI", "Tableau", "Statistics", "Machine Learning", "MLOps & LLMOps", "Reporting"],
  "advanced-aiml-genai-agentic": ["Python", "SQL Server", "Statistics", "Machine Learning", "Deep Learning", "Generative AI", "RAG Systems", "Agentic AI", "Transformers"],
  "master-genai-agentic": ["Python", "Deep Learning", "Generative AI", "RAG Systems", "Agentic AI", "Multi-Agent Systems", "Transformers", "Fine-Tuning"],
  "data-analytics-specialist": ["Python", "SQL Server", "Excel AI", "Power BI", "Tableau", "Reporting"],
  "apcs": ["Cybersecurity", "Ethical Hacking", "Digital Forensics", "Incident Response"]
};

const COURSE_MASCOT_INTROS = {
  apids: "This is the broadest AI path here. It takes you from analytics and machine learning into GenAI, agents, and deployment.",
  apida: "This track is more business-analytics focused, with dashboards, reporting, statistics, and practical machine learning.",
  "advanced-aiml-genai-agentic": "This one is for learners who want stronger AI foundations before going deeper into GenAI and agentic workflows.",
  "master-genai-agentic": "This is the more focused GenAI builder track, with transformers, RAG, fine-tuning, and multi-agent systems.",
  "data-analytics-specialist": "This is a career-starter analytics path centered on SQL, Python, Excel AI, Power BI, and dashboard work.",
  apcs: "This path is built for cybersecurity, ethical hacking, incident response, and digital forensics with hands-on labs."
};

const SKILL_CATEGORIES = [
  {
    name: "Data & BI Tools",
    skills: ["SQL Server", "Excel AI", "Power BI", "Tableau", "PySpark & SAS", "Reporting"]
  },
  {
    name: "Data Science & ML",
    skills: ["Python", "Statistics", "Machine Learning", "Deep Learning", "MLOps & LLMOps"]
  },
  {
    name: "Generative AI & Agents",
    skills: ["Generative AI", "RAG Systems", "Agentic AI", "Multi-Agent Systems", "Transformers", "Fine-Tuning"]
  },
  {
    name: "Cybersecurity",
    skills: ["Cybersecurity", "Ethical Hacking", "Digital Forensics", "Incident Response"]
  }
];

const selectedSkills = new Set();

function renderCourseAccordion(course) {
  const accordionContainer = document.getElementById("courseModalAccordion");
  if (!accordionContainer) return;

  const sections = Array.isArray(course.sections) ? course.sections : [];

  accordionContainer.innerHTML = sections.map((section, index) => {
    const isFirst = index === 0;
    
    let contentHtml = "";
    if (isCurriculumSection(section)) {
      contentHtml = renderCurriculumSection(section);
    } else {
      contentHtml = `
        ${(Array.isArray(section.paragraphs) ? section.paragraphs : [])
          .map((paragraph) => `<p class="accordion-paragraph">${escapeHtml(paragraph)}</p>`)
          .join("")}
        ${Array.isArray(section.bullets) && section.bullets.length ? `
          <ul class="accordion-list">
            ${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
        ` : ""}
      `;
    }

    return `
      <div class="accordion-item ${isFirst ? "accordion-item--active" : ""}">
        <button type="button" class="accordion-trigger" aria-expanded="${isFirst ? "true" : "false"}" data-accordion-index="${index}">
          <span class="accordion-title">${escapeHtml(section.title)}</span>
          <span class="accordion-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </button>
        <div class="accordion-content" style="${isFirst ? "" : "display: none;"}">
          <div class="accordion-content-inner">
            ${contentHtml}
          </div>
        </div>
      </div>
    `;
  }).join("");

  accordionContainer.querySelectorAll("[data-accordion-index]").forEach((trigger) => {
    trigger.onclick = () => {
      const item = trigger.closest(".accordion-item");
      const content = item.querySelector(".accordion-content");
      const isExpanded = trigger.getAttribute("aria-expanded") === "true";

      // Collapse all other items
      accordionContainer.querySelectorAll(".accordion-item").forEach((otherItem) => {
        if (otherItem !== item) {
          otherItem.classList.remove("accordion-item--active");
          const otherTrigger = otherItem.querySelector(".accordion-trigger");
          otherTrigger.setAttribute("aria-expanded", "false");
          const otherContent = otherItem.querySelector(".accordion-content");
          otherContent.style.display = "none";
        }
      });

      // Toggle current item
      if (isExpanded) {
        item.classList.remove("accordion-item--active");
        trigger.setAttribute("aria-expanded", "false");
        content.style.display = "none";
      } else {
        item.classList.add("accordion-item--active");
        trigger.setAttribute("aria-expanded", "true");
        content.style.display = "block";
      }
    };
  });

  accordionContainer.querySelectorAll("[data-curriculum-index]").forEach((trigger) => {
    trigger.onclick = () => {
      const card = trigger.closest(".curriculum-card");
      const content = card.querySelector(".curriculum-card__content");
      const toggle = trigger.querySelector(".curriculum-card__toggle");
      const isExpanded = trigger.getAttribute("aria-expanded") === "true";

      if (isExpanded) {
        trigger.setAttribute("aria-expanded", "false");
        card.classList.remove("curriculum-card--active");
        content.style.display = "none";
        if (toggle) toggle.textContent = "+";
      } else {
        trigger.setAttribute("aria-expanded", "true");
        card.classList.add("curriculum-card--active");
        content.style.display = "block";
        if (toggle) toggle.textContent = "−";
      }
    };
  });
}

const COURSE_HOOKS = {
  apids: {
    highlights: [
      "GenAI & Agentic AI focus with multi-agent system workflows",
      "Real-world projects across banking, healthcare, retail, & telecom",
      "Comprehensive MLOps & LLMOps deployment training for production"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "240+ Learning Hours",
        subtext: "Instructor-Led Sessions"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "6-8 Months",
        subtext: "Program Duration"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "Placement Assistance*",
        subtext: "Dedicated Hiring Network"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Career Support",
        subtext: "For Freshers & Professionals"
      }
    ]
  },
  apida: {
    highlights: [
      "Focused on business intelligence, reporting, & executive dashboards",
      "Master SQL, Python, Excel AI, Power BI & Tableau",
      "Applied machine learning & decision-making statistics"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "180+ Learning Hours",
        subtext: "Hands-on Lab Exercises"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "4-5 Months",
        subtext: "Flexible Scheduling"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "15+ Industry Cases",
        subtext: "Real Domain Data Analysis"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Placement Assistance",
        subtext: "Resume Prep & Mock Interviews"
      }
    ]
  },
  "advanced-aiml-genai-agentic": {
    highlights: [
      "Advanced neural networks, deep learning & transformer architectures",
      "Design multi-agent setups with LangGraph, CrewAI & AutoGen",
      "Deploy scalable systems using advanced MLOps & cloud scaling"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "200+ Learning Hours",
        subtext: "Deep Technical Coding"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "4 Months",
        subtext: "Accelerated Learning Track"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "Hands-on GPU Labs",
        subtext: "Train Models on Cloud GPUs"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "Career Support",
        subtext: "Resume Prep & Mock Interviews"
      }
    ]
  },
  "master-genai-agentic": {
    highlights: [
      "Deep dive into LLMs, prompt engineering, & prompt routing",
      "Build RAG systems, vector search, & custom indexing layers",
      "Construct production-grade autonomous agent networks"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "120+ Learning Hours",
        subtext: "Focus on Builder Labs"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "3 Months",
        subtext: "Fast-Track Specialization"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "8+ GenAI Projects",
        subtext: "Ready-to-Deploy Portfolio Apps"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Recorded Learning Access",
        subtext: "Revise Sessions & Project Work"
      }
    ]
  },
  "data-analytics-specialist": {
    highlights: [
      "Perfect career transition pathway for non-technical fields",
      "Learn SQL database structures, Excel macros & core statistics",
      "Interactive data storytelling with Power BI & Tableau dashboards"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "100+ Learning Hours",
        subtext: "Beginner-Friendly Lectures"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "3 Months",
        subtext: "Rapid Career Pivot"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "10+ Reporting Projects",
        subtext: "Interactive BI Deployments"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Placement Assistance",
        subtext: "Resume, LinkedIn & Mock Interviews"
      }
    ]
  },
  apcs: {
    highlights: [
      "Bridge learning, ethical hacking, and cyber forensics in one pathway",
      "Hands-on labs across malware analysis, phishing, DFIR, and security operations",
      "Mock interviews, alumni connect, and certification preparation support"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "180 Learning Hours",
        subtext: "Hands-on Security Labs"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "3-4 Months",
        subtext: "Immersive Security Track"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "Live & Recorded Classes",
        subtext: "Flexible Revision Support"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Certification Prep",
        subtext: "Mock Interviews & Alumni Connect"
      }
    ]
  }
};

function openCourseDetails(courseId) {
  const course = findCourseById(courseId);
  if (!course) {
    return;
  }

  currentDetailsCourseId = courseId;

  document.getElementById("courseModalBadge").textContent = course.badge;
  document.getElementById("courseModalTitle").textContent = course.name;
  
  // Retrieve hooks for this course
  const hooks = COURSE_HOOKS[course.id] || { highlights: [], features: [] };
  
  // Render bullets (highlights) with check SVGs
  const bulletsContainer = document.getElementById("courseModalHookBullets");
  bulletsContainer.innerHTML = (hooks.highlights || []).map((highlight) => `
    <li>
      <span class="hook-bullet-icon-wrap" aria-hidden="true">
        <svg class="hook-bullet-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
      <span class="hook-bullet-text">${escapeHtml(highlight)}</span>
    </li>
  `).join("");

  // Render Features Grid
  const featuresContainer = document.getElementById("courseModalFeaturesGrid");
  featuresContainer.innerHTML = (hooks.features || []).map((feat) => `
    <div class="modal-feature-item">
      <div class="modal-feature-icon-wrap" aria-hidden="true">
        ${feat.icon}
      </div>
      <div class="modal-feature-text">
        <h4 class="modal-feature-title">${escapeHtml(feat.title)}</h4>
        <span class="modal-feature-subtext">${escapeHtml(feat.subtext)}</span>
      </div>
    </div>
  `).join("");

  renderCourseAccordion(course);
  courseDetailsModal.classList.remove("hidden");
  notifyMascot("course-details", { courseName: course.name });
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
  notifyMascot("register-opened", { courseName: course.name });
}

function closeRegisterModal() {
  registerModal.classList.add("hidden");
  shouldDownloadAfterRegister = false;
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

function triggerBrochureDownload() {
  const link = document.createElement("a");
  link.href = "Logos/Brochure.pdf";
  link.download = "Brochure.pdf";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
      localStorage.setItem("candidateRegistered", "true");
      if (shouldDownloadAfterRegister) {
        triggerBrochureDownload();
        shouldDownloadAfterRegister = false;
        setTimeout(() => {
          closeRegisterModal();
        }, 1500);
      }
      return;
    }

    localStorage.setItem("candidateRegistered", "true");
    closeRegisterModal();
    openSuccessModal();
    if (shouldDownloadAfterRegister) {
      triggerBrochureDownload();
      shouldDownloadAfterRegister = false;
    }
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
document.getElementById("closeRegisterModalBtn").onclick = closeRegisterModal;
document.getElementById("cancelRegistrationBtn").onclick = closeRegisterModal;
document.getElementById("closeSuccessModalBtn").onclick = closeSuccessModal;
registerForm.addEventListener("submit", submitRegistration);

document.getElementById("downloadBrochureBtn").onclick = () => {
  if (localStorage.getItem("candidateRegistered") === "true") {
    triggerBrochureDownload();
  } else {
    shouldDownloadAfterRegister = true;
    openRegisterModal(currentDetailsCourseId || PUBLIC_COURSES[0].id);
  }
};

[courseDetailsModal, registerModal, successModal].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  });
});

const GAME_TARGET_SKILLS = 3;
const RELATED_SKILL_PATHS = {
  "Generative AI": [
    { skill: "Transformers", weight: 0.25 },
    { skill: "RAG Systems", weight: 0.25 },
    { skill: "Agentic AI", weight: 0.25 }
  ],
  "Agentic AI": [
    { skill: "Generative AI", weight: 0.3 },
    { skill: "RAG Systems", weight: 0.2 },
    { skill: "Multi-Agent Systems", weight: 0.35 }
  ],
  "RAG Systems": [
    { skill: "Generative AI", weight: 0.35 },
    { skill: "Transformers", weight: 0.2 },
    { skill: "Agentic AI", weight: 0.15 }
  ],
  "Transformers": [
    { skill: "Generative AI", weight: 0.45 },
    { skill: "Deep Learning", weight: 0.35 },
    { skill: "RAG Systems", weight: 0.25 },
    { skill: "Agentic AI", weight: 0.2 }
  ],
  "Fine-Tuning": [
    { skill: "Transformers", weight: 0.35 },
    { skill: "Generative AI", weight: 0.35 },
    { skill: "Deep Learning", weight: 0.2 }
  ],
  "Multi-Agent Systems": [
    { skill: "Agentic AI", weight: 0.35 },
    { skill: "Generative AI", weight: 0.15 }
  ],
  "Deep Learning": [
    { skill: "Machine Learning", weight: 0.25 },
    { skill: "Transformers", weight: 0.2 }
  ],
  "Machine Learning": [
    { skill: "Deep Learning", weight: 0.2 },
    { skill: "Python", weight: 0.15 },
    { skill: "Statistics", weight: 0.15 }
  ],
  "Power BI": [
    { skill: "Reporting", weight: 0.35 },
    { skill: "Excel AI", weight: 0.25 },
    { skill: "Tableau", weight: 0.2 }
  ],
  "Tableau": [
    { skill: "Reporting", weight: 0.35 },
    { skill: "Power BI", weight: 0.2 }
  ],
  "Ethical Hacking": [
    { skill: "Cybersecurity", weight: 0.35 },
    { skill: "Incident Response", weight: 0.15 }
  ]
};

const SKILL_ARCHETYPES = [
  {
    key: "ai-builder",
    label: "AI Builder",
    description: "Python + ML + Deep Learning",
    matches(skills) {
      return ["Python", "Machine Learning", "Deep Learning"].filter((skill) => skills.has(skill)).length >= 2;
    }
  },
  {
    key: "genai-operator",
    label: "GenAI Operator",
    description: "Generative AI + RAG + Agents",
    matches(skills) {
      return ["Generative AI", "RAG Systems", "Agentic AI"].filter((skill) => skills.has(skill)).length >= 2;
    }
  },
  {
    key: "automation-architect",
    label: "Automation Architect",
    description: "Transformers + agents + tuning",
    matches(skills) {
      return ["Transformers", "Multi-Agent Systems", "Fine-Tuning", "Agentic AI"].filter((skill) => skills.has(skill)).length >= 2;
    }
  },
  {
    key: "insight-analyst",
    label: "Insight Analyst",
    description: "SQL + BI + Reporting",
    matches(skills) {
      return ["SQL Server", "Power BI", "Tableau", "Reporting", "Excel AI"].filter((skill) => skills.has(skill)).length >= 2;
    }
  },
  {
    key: "security-defender",
    label: "Security Defender",
    description: "Cyber defense and response",
    matches(skills) {
      return ["Cybersecurity", "Ethical Hacking", "Incident Response", "Digital Forensics"].filter((skill) => skills.has(skill)).length >= 2;
    }
  }
];

let lastTopCourseId = null;
let lastArchetypeKey = "";
let latestSortedMatches = [];
let latestCourseMatchMap = new Map();
let lastHoveredCourseId = null;

function notifyMascot(eventName, detail = {}) {
  if (window.mascotReactToGameEvent) {
    window.mascotReactToGameEvent(eventName, detail);
  }
}

function formatSkillList(skills) {
  if (skills.length <= 1) return skills[0] || "";
  if (skills.length === 2) return `${skills[0]} and ${skills[1]}`;
  return `${skills.slice(0, -1).join(", ")}, and ${skills.at(-1)}`;
}

function setMascotActionState(actionName) {
  if (!mascotActionDock) return;
  mascotActionDock.querySelectorAll("[data-mascot-action]").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-mascot-action") === actionName);
  });

  if (actionName) {
    window.setTimeout(() => {
      mascotActionDock.querySelectorAll(".is-active").forEach((button) => button.classList.remove("is-active"));
    }, 1200);
  }
}

function getTopCourseMatches(limit = 2) {
  return latestSortedMatches.filter((entry) => entry.rawScore > 0).slice(0, limit);
}

function getUnlockedArchetypes() {
  return SKILL_ARCHETYPES.filter((archetype) => archetype.matches(selectedSkills));
}

function getSupportBonus(courseSkills, selectedSkill) {
  const relations = RELATED_SKILL_PATHS[selectedSkill] || [];
  const relationScore = relations.reduce((sum, relation) => {
    return sum + (courseSkills.includes(relation.skill) ? relation.weight : 0);
  }, 0);
  return Math.min(0.12, relationScore * 0.08);
}

function scoreCourse(course) {
  const selected = Array.from(selectedSkills);
  const courseSkills = COURSE_SKILLS[course.id] || [];
  const exactMatches = [];
  const adjacentMatches = [];
  let totalScore = 0;

  selected.forEach((selectedSkill) => {
    if (courseSkills.includes(selectedSkill)) {
      exactMatches.push(selectedSkill);
      totalScore += 1 + getSupportBonus(courseSkills, selectedSkill);
      return;
    }

    const relations = RELATED_SKILL_PATHS[selectedSkill] || [];
    let bestRelation = null;

    relations.forEach((relation) => {
      if (courseSkills.includes(relation.skill) && (!bestRelation || relation.weight > bestRelation.weight)) {
        bestRelation = relation;
      }
    });

    if (bestRelation) {
      totalScore += bestRelation.weight;
      adjacentMatches.push({
        selectedSkill,
        supportingSkill: bestRelation.skill,
        weight: bestRelation.weight
      });
    }
  });

  return {
    courseId: course.id,
    exactMatches,
    adjacentMatches,
    rawScore: selected.length ? totalScore / selected.length : 0,
    matchPct: selected.length ? Math.round(Math.min(1, totalScore / selected.length) * 100) : 0
  };
}

function getSkillAdvice(skill, isSelected) {
  if (!isSelected) {
    return {
      text: `Removed ${skill}. Keep exploring until the path feels right.`,
      expr: "neutral"
    };
  }

  if (selectedSkills.has("Python") && selectedSkills.has("Deep Learning")) {
    return {
      text: "Strong combo. Python and Deep Learning are pushing you toward serious AI builder roles.",
      expr: "happy"
    };
  }

  if (selectedSkills.has("SQL Server") && selectedSkills.has("PySpark & SAS")) {
    return {
      text: "That is a solid analytics foundation. SQL Server plus PySpark opens up practical data workflows.",
      expr: "happy"
    };
  }

  if (selectedSkills.has("Generative AI") && selectedSkills.has("Agentic AI")) {
    return {
      text: "Nice. Generative AI with Agentic AI is a powerful modern product combination.",
      expr: "happy"
    };
  }

  if (selectedSkills.has("Cybersecurity") && selectedSkills.has("Ethical Hacking")) {
    return {
      text: "Security path unlocked. You are mixing defense thinking with hands-on testing.",
      expr: "happy"
    };
  }

  switch (skill) {
    case "Python":
      return { text: "Python is a great starting point. It connects almost every AI and data path here.", expr: "happy" };
    case "Machine Learning":
      return { text: "Machine Learning is in play. Deep Learning is a smart next unlock.", expr: "happy" };
    case "Deep Learning":
      return { text: "Deep Learning opens the door to NLP, computer vision, and Transformers.", expr: "happy" };
    case "Statistics":
      return { text: "Statistics gives you the decision-making backbone behind strong models.", expr: "neutral" };
    case "SQL Server":
      return { text: "SQL Server is a strong data foundation. Pair it with BI or Python for momentum.", expr: "surprised" };
    case "PySpark & SAS":
      return { text: "PySpark and SAS push you toward large-scale analytics and industry data workflows.", expr: "surprised" };
    case "Power BI":
      return { text: "Power BI is perfect for turning analysis into business-ready stories.", expr: "happy" };
    case "Generative AI":
      return { text: "Generative AI is a big unlock. RAG, Transformers, and agents are natural next moves.", expr: "surprised" };
    case "RAG Systems":
      return { text: "RAG Systems connect models to live knowledge and make GenAI more practical.", expr: "happy" };
    case "Agentic AI":
      return { text: "Agentic AI adds planning, reasoning, and tool use to your stack.", expr: "happy" };
    case "Multi-Agent Systems":
      return { text: "Multi-agent systems are ideal when you want specialized AI roles working together.", expr: "happy" };
    case "Transformers":
      return { text: "Transformers are core GenAI infrastructure. Good pick if you want to go deeper than prompting.", expr: "surprised" };
    case "Fine-Tuning":
      return { text: "Fine-Tuning is a strong advanced skill when you want custom model behavior.", expr: "happy" };
    case "Cybersecurity":
      return { text: "Cybersecurity stays in demand. Ethical Hacking is a smart next step.", expr: "surprised" };
    case "Ethical Hacking":
      return { text: "Ethical Hacking sharpens your ability to find problems before attackers do.", expr: "happy" };
    case "Digital Forensics":
      return { text: "Digital Forensics is for careful investigators who want to trace what really happened.", expr: "surprised" };
    case "Incident Response":
      return { text: "Incident Response prepares you to move fast during active security events.", expr: "happy" };
    default:
      return { text: `Nice choice. ${skill} adds another useful layer to your path.`, expr: "happy" };
  }
}

function updateSkillTreeDashboard(sortedMatches) {
  const selectedCount = selectedSkills.size;
  const progressValue = Math.min(selectedCount, GAME_TARGET_SKILLS);
  const progressPct = Math.round((progressValue / GAME_TARGET_SKILLS) * 100);

  if (skillMissionTitle) {
    if (selectedCount === 0) {
      skillMissionTitle.textContent = "Choose your first skill";
    } else if (selectedCount < GAME_TARGET_SKILLS) {
      skillMissionTitle.textContent = `Build your stack: ${selectedCount}/${GAME_TARGET_SKILLS} selected`;
    } else {
      skillMissionTitle.textContent = "Path unlocked";
    }
  }

  if (skillProgressFill) {
    skillProgressFill.style.width = `${progressPct}%`;
  }

  if (skillProgressText) {
    if (selectedCount === 0) {
      skillProgressText.textContent = "Select 1 of 3 skills to unlock your path.";
    } else if (selectedCount < GAME_TARGET_SKILLS) {
      skillProgressText.textContent = `Add ${GAME_TARGET_SKILLS - selectedCount} more skill${GAME_TARGET_SKILLS - selectedCount === 1 ? "" : "s"} to complete the core mission.`;
    } else {
      skillProgressText.textContent = "You have enough signal. Explore the highlighted course and refine your stack.";
    }
  }

  const unlockedArchetypes = getUnlockedArchetypes();
  if (skillArchetypeBadges) {
    skillArchetypeBadges.innerHTML = unlockedArchetypes.length
      ? unlockedArchetypes.map((archetype) => `
          <article class="skill-archetype-badge">
            <span class="skill-archetype-badge__label">${escapeHtml(archetype.label)}</span>
            <span class="skill-archetype-badge__meta">${escapeHtml(archetype.description)}</span>
          </article>
        `).join("")
      : `
          <article class="skill-archetype-badge skill-archetype-badge--empty">
            <span class="skill-archetype-badge__label">Archetypes unlock as you combine skills</span>
            <span class="skill-archetype-badge__meta">Try pairs like Python + Deep Learning or Generative AI + Agentic AI.</span>
          </article>
        `;
  }

  if (!skillMatchTitle || !skillMatchBody) return;

  if (!selectedCount || !sortedMatches.length || sortedMatches[0].matchPct === 0) {
    skillMatchTitle.textContent = "No path revealed yet";
    skillMatchBody.textContent = "Start with one or two skills and the game will explain which course fits and why.";
    lastTopCourseId = null;
    lastArchetypeKey = unlockedArchetypes.map((archetype) => archetype.key).join("|");
    return;
  }

  const topMatch = sortedMatches[0];
  const topCourse = findCourseById(topMatch.courseId);
  const exactLabel = topMatch.exactMatches.length ? formatSkillList(topMatch.exactMatches) : "";
  const adjacentLabel = topMatch.adjacentMatches.length
    ? `${topMatch.adjacentMatches[0].selectedSkill} is supported through ${topMatch.adjacentMatches[0].supportingSkill}`
    : "";

  skillMatchTitle.textContent = `${topCourse?.name || "Top program"} is your strongest match at ${topMatch.matchPct}%`;
  skillMatchBody.textContent = topMatch.exactMatches.length
    ? `Exact coverage for ${exactLabel}.${adjacentLabel ? ` Also, ${adjacentLabel}.` : ""}`
    : `Closest related match: ${adjacentLabel}.`;

  if (topMatch.courseId !== lastTopCourseId) {
    notifyMascot("best-match", {
      courseName: topCourse?.name || "your best match",
      matchPct: topMatch.matchPct
    });
  }

  const newArchetypeKey = unlockedArchetypes.map((archetype) => archetype.key).join("|");
  if (newArchetypeKey && newArchetypeKey !== lastArchetypeKey) {
    notifyMascot("archetype-unlocked", {
      label: unlockedArchetypes[0].label
    });
  }

  lastTopCourseId = topMatch.courseId;
  lastArchetypeKey = newArchetypeKey;
}

function helpChooseWithMascot() {
  if (!selectedSkills.size) {
    if (skillTreeSection?.classList.contains("hidden")) {
      skillTreeSection.classList.remove("hidden");
      syncGamePanelState();
    }
    window.mascotShowSpeech?.("Start with one anchor skill like Python, Power BI, or Generative AI and I will narrow the path.", "happy");
    return;
  }

  const unlockedArchetypes = getUnlockedArchetypes();
  const suggestion = unlockedArchetypes.length
    ? `You are leaning toward ${unlockedArchetypes[0].label}. Add one more supporting skill to sharpen the recommendation.`
    : `You have ${selectedSkills.size} skills selected. Try pairing related skills like Generative AI with Agentic AI, or Python with Deep Learning.`;

  window.mascotShowSpeech?.(suggestion, "neutral");
}

function explainTopMatchWithMascot() {
  const topMatch = getTopCourseMatches(1)[0];
  if (!topMatch) {
    window.mascotShowSpeech?.("I need at least one selected skill before I can explain a match clearly.", "surprised");
    return;
  }

  const course = findCourseById(topMatch.courseId);
  const exactLabel = topMatch.exactMatches.length ? formatSkillList(topMatch.exactMatches.slice(0, 3)) : "";
  const adjacentLabel = topMatch.adjacentMatches.length
    ? `${topMatch.adjacentMatches[0].selectedSkill} is supported by ${topMatch.adjacentMatches[0].supportingSkill}`
    : "";
  const explanation = exactLabel
    ? `${course?.name || "This course"} leads because it directly covers ${exactLabel}.${adjacentLabel ? ` Also, ${adjacentLabel}.` : ""}`
    : `${course?.name || "This course"} is closest because ${adjacentLabel}.`;

  window.mascotShowSpeech?.(explanation, "happy");
}

function compareTopCoursesWithMascot() {
  const [firstMatch, secondMatch] = getTopCourseMatches(2);
  if (!firstMatch || !secondMatch) {
    window.mascotShowSpeech?.("Pick a few skills first. Then I can compare the top two programs for you.", "surprised");
    return;
  }

  const firstCourse = findCourseById(firstMatch.courseId);
  const secondCourse = findCourseById(secondMatch.courseId);
  const message = `${firstCourse?.name || "Course 1"} is stronger on ${formatSkillList(firstMatch.exactMatches.slice(0, 2)) || "your exact picks"}, while ${secondCourse?.name || "Course 2"} stays close at ${secondMatch.matchPct}% for a broader option.`;
  window.mascotShowSpeech?.(message, "neutral");
}

function renderSkillTree() {
  const container = document.getElementById("skillTreeCategories");
  if (!container) return;

  container.innerHTML = SKILL_CATEGORIES.map((category) => {
    const skillsHtml = category.skills.map((skill) => {
      const isSelected = selectedSkills.has(skill);
      return `
        <button type="button" class="skill-tag ${isSelected ? "selected" : ""}" data-skill="${escapeHtml(skill)}" aria-pressed="${isSelected ? "true" : "false"}">
          ${isSelected ? '<span class="skill-tag__check" aria-hidden="true">+</span>' : ""}
          ${escapeHtml(skill)}
        </button>
      `;
    }).join("");

    return `
      <div class="skill-category">
        <h3 class="skill-category-title">${escapeHtml(category.name)}</h3>
        <div class="skill-tags-list">
          ${skillsHtml}
        </div>
      </div>
    `;
  }).join("");

  const resetBtn = document.getElementById("resetSkillsBtn");
  if (resetBtn) {
    resetBtn.style.display = selectedSkills.size > 0 ? "inline-flex" : "none";
  }

  container.querySelectorAll(".skill-tag").forEach((tag) => {
    tag.addEventListener("click", () => {
      const skill = tag.getAttribute("data-skill");
      const isNowSelected = !selectedSkills.has(skill);

      if (isNowSelected) {
        selectedSkills.add(skill);
      } else {
        selectedSkills.delete(skill);
      }

      renderSkillTree();
      renderCourses();

      const advice = getSkillAdvice(skill, isNowSelected);
      if (window.mascotShowSpeech) {
        window.mascotShowSpeech(advice.text, advice.expr);
      }
    });
  });
}

function renderCourses() {
  const hasSelection = selectedSkills.size > 0;
  const scoredMatches = PUBLIC_COURSES.map((course) => ({
    course,
    ...scoreCourse(course)
  }));
  const maxRawScore = hasSelection ? Math.max(...scoredMatches.map((entry) => entry.rawScore)) : 0;
  latestSortedMatches = [...scoredMatches].sort((a, b) => b.rawScore - a.rawScore);
  latestCourseMatchMap = new Map(scoredMatches.map((entry) => [entry.course.id, entry]));
  lastHoveredCourseId = null;

  coursesGrid.innerHTML = scoredMatches.map(({ course, matchPct, rawScore, exactMatches, adjacentMatches }) => {
    const { rating, reviews } = getFakeRating(course.id);
    const isBestMatch = hasSelection && rawScore > 0 && Math.abs(rawScore - maxRawScore) < 0.0001;
    const whyMatched = exactMatches.length
      ? `Best on: ${formatSkillList(exactMatches.slice(0, 2))}`
      : adjacentMatches.length
        ? `Related via ${adjacentMatches[0].supportingSkill}`
        : "";

    return `
      <article class="course-card ${isBestMatch ? "course-card--best-match" : ""}" data-course-card="${course.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(course.name)} details">
        ${hasSelection ? `<span class="course-card__match-badge">${matchPct}% Match</span>` : ""}
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
        ${whyMatched ? `<p class="course-card__match-reason">${escapeHtml(whyMatched)}</p>` : ""}
        <div class="course-card__rating" title="${rating} out of 5 stars based on ${reviews} reviews">
          <div class="course-card__stars">
            ${renderStars(rating)}
          </div>
          <span class="course-card__rating-val">${rating}</span>
          <span class="course-card__reviews">(${reviews})</span>
        </div>
        <div class="course-card__actions">
          <button type="button" class="btn-ghost check-details-btn" data-check-details="${course.id}">Check Details</button>
          <button type="button" class="btn-primary register-course-btn" data-register-course="${course.id}">Register Now</button>
        </div>
      </article>
    `;
  }).join("");

  updateSkillTreeDashboard(latestSortedMatches);

  document.querySelectorAll("[data-course-card]").forEach((card) => {
    const courseId = card.getAttribute("data-course-card");
    card.addEventListener("click", (event) => {
      if (event.target.closest(".register-course-btn") || event.target.closest(".check-details-btn")) {
        return;
      }
      openCourseDetails(courseId);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCourseDetails(courseId);
      }
    });
    card.addEventListener("mouseenter", () => {
      const matchData = latestCourseMatchMap.get(courseId);
      const course = findCourseById(courseId);
      if (!course || !matchData || courseId === lastHoveredCourseId) return;
      lastHoveredCourseId = courseId;
      const hoverMessage = selectedSkills.size === 0
        ? (COURSE_MASCOT_INTROS[course.id] || `${course.name} is one of the main learning paths available here.`)
        : matchData.matchPct > 0
          ? `${course.name} is at ${matchData.matchPct}% because it lines up with ${formatSkillList(matchData.exactMatches.slice(0, 2)) || "related skills"}.`
          : `${course.name} explores a different direction. If you want, I can help you find the skills that match it better.`;
      notifyMascot("course-hover", {
        courseName: course.name,
        matchPct: matchData.matchPct,
        message: hoverMessage
      });
    });
    card.addEventListener("focus", () => {
      const matchData = latestCourseMatchMap.get(courseId);
      const course = findCourseById(courseId);
      if (!course || !matchData) return;
      notifyMascot("course-hover", {
        courseName: course.name,
        matchPct: matchData.matchPct,
        message: `${course.name} is ready to inspect.`
      });
    });
  });

  document.querySelectorAll("[data-check-details]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openCourseDetails(button.getAttribute("data-check-details"));
    });
  });

  document.querySelectorAll("[data-register-course]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openRegisterModal(button.getAttribute("data-register-course"));
    });
  });
}

renderCourses();
renderSkillTree();
renderSuccessStories();

// Mascot Dynamic Coordinate Positioning helper
function updateMascotPosition() {
  // Statically positioned on the right of the main heading panel
}

// Trigger transition jump slide
function transitionMascot(inGame) {
  const jumper = document.getElementById("mascotJumper");
  if (!jumper) return;
  
  // Hop jump landing effect
  jumper.classList.remove("mascot-hop");
  void jumper.offsetWidth;
  jumper.classList.add("mascot-hop");
  
}

// Re-position mascot dynamically on window resize
window.addEventListener("resize", updateMascotPosition);

const resetSkillsBtn = document.getElementById("resetSkillsBtn");
if (resetSkillsBtn) {
  resetSkillsBtn.addEventListener("click", () => {
    selectedSkills.clear();
    lastTopCourseId = null;
    lastArchetypeKey = "";
    renderSkillTree();
    renderCourses();
    notifyMascot("skills-reset");
  });
}

const toggleGamePanelBtn = document.getElementById("toggleGamePanelBtn");
const skillTreeSection = document.getElementById("skillTreeSection");
const toggleGamePanelLabel = document.querySelector(".courses-hero__game-msg");
const isMobileCoursesView = window.matchMedia("(max-width: 768px)");

function syncGamePanelState() {
  if (!toggleGamePanelBtn || !skillTreeSection) return;
  const isOpen = !skillTreeSection.classList.contains("hidden");
  toggleGamePanelBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (toggleGamePanelLabel) {
    toggleGamePanelLabel.textContent = isOpen ? "Hide Skill Match Game" : "Play Skill Match Game";
  }
}

function syncMobileExperience() {
  if (!skillTreeSection) return;
  if (isMobileCoursesView.matches) {
    skillTreeSection.classList.add("hidden");
    if (toggleGamePanelBtn) {
      toggleGamePanelBtn.setAttribute("aria-expanded", "false");
    }
  }
  syncGamePanelState();
}

if (toggleGamePanelBtn && skillTreeSection) {
  toggleGamePanelBtn.addEventListener("click", () => {
    if (isMobileCoursesView.matches) {
      skillTreeSection.classList.add("hidden");
      syncGamePanelState();
      return;
    }
    const isOpening = skillTreeSection.classList.contains("hidden");
    
    skillTreeSection.classList.toggle("hidden");
    syncGamePanelState();
    
    if (isOpening) {
      transitionMascot(true);
      notifyMascot("game-opened");
    } else {
      transitionMascot(false);
      notifyMascot("game-closed");
    }
  });
}

const closeSkillTreeBtn = document.getElementById("closeSkillTreeBtn");
if (closeSkillTreeBtn && skillTreeSection) {
  closeSkillTreeBtn.addEventListener("click", () => {
    skillTreeSection.classList.add("hidden");
    syncGamePanelState();
    transitionMascot(false);
    notifyMascot("game-closed");
  });
}

if (isMobileCoursesView?.addEventListener) {
  isMobileCoursesView.addEventListener("change", syncMobileExperience);
}

syncMobileExperience();

const surpriseSkillsBtn = document.getElementById("surpriseSkillsBtn");
if (surpriseSkillsBtn) {
  surpriseSkillsBtn.addEventListener("click", () => {
    const starterSkillsByArchetype = {
      "ai-builder": ["Python", "Machine Learning", "Deep Learning"],
      "genai-operator": ["Generative AI", "RAG Systems", "Agentic AI"],
      "automation-architect": ["Transformers", "Agentic AI", "Fine-Tuning"],
      "insight-analyst": ["SQL Server", "Power BI", "Reporting"],
      "security-defender": ["Cybersecurity", "Ethical Hacking", "Incident Response"]
    };
    const archetype = SKILL_ARCHETYPES[Math.floor(Math.random() * SKILL_ARCHETYPES.length)];
    selectedSkills.clear();
    (starterSkillsByArchetype[archetype.key] || []).forEach((skill) => selectedSkills.add(skill));
    renderSkillTree();
    renderCourses();
    notifyMascot("surprise-path", { label: archetype.label });
  });
}

if (mascotActionDock) {
  mascotActionDock.querySelectorAll("[data-mascot-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const actionName = button.getAttribute("data-mascot-action");
      setMascotActionState(actionName);
      switch (actionName) {
        case "help-choose":
          helpChooseWithMascot();
          break;
        case "explain-match":
          explainTopMatchWithMascot();
          break;
        case "surprise-path":
          surpriseSkillsBtn?.click();
          break;
        case "compare-courses":
          compareTopCoursesWithMascot();
          break;
        default:
          break;
      }
    });
  });
}

syncGamePanelState();



export const AED_EXCHANGE_RATE_INR = 23.35;

function withGst(basePriceInr) {
  return Math.round(basePriceInr * 1.18);
}

function toAed(amountInr) {
  return Math.round(amountInr / AED_EXCHANGE_RATE_INR);
}

function buildPrice(basePriceInr, customAed = null) {
  const totalInr = withGst(basePriceInr);
  return {
    baseInr: basePriceInr,
    totalInr,
    totalAed: customAed !== null ? customAed : toAed(totalInr)
  };
}

function buildSection(title, paragraphs = [], bullets = []) {
  return { title, paragraphs, bullets };
}

function buildCurriculumSection(title, intro = [], items = []) {
  return { title, paragraphs: intro, curriculumItems: items };
}

export const PUBLIC_COURSES = [
  {
    id: "apids",
    shortName: "APIDS",
    code: "APIDS",
    poster: "Logos/APIDS.jpeg",
    name: "Advanced Program in Industrial Data Science & AI",
    duration: "6-8 Months",
    price: buildPrice(300000, 20000),
    badge: "Flagship Program",
    headline: "Build full-stack data science, machine learning, generative AI, and agentic AI skills in one career track.",
    sections: [
      buildSection("Program Overview", [
        "APIDS is a complete industry-oriented program for graduates and working professionals who want to become Data Science and AI practitioners.",
        "The program covers the journey from data management and analytics to machine learning, deep learning, generative AI, agentic AI, and cloud deployment."
      ]),
      buildSection("Program Highlights", [], [
        "Instructor-led training with interactive live sessions and real-time doubt clarification",
        "24/7 LMS access for recordings, study resources, notes, and progress tracking",
        "Assignments and case studies that strengthen problem-solving through applied practice",
        "Real-time industry projects that help you apply concepts to practical scenarios",
        "An end-to-end capstone project to showcase real-world delivery skills",
        "Resume preparation to present your skills, projects, and achievements clearly",
        "LinkedIn optimization to strengthen your professional profile and recruiter visibility",
        "Mock interviews with feedback to improve confidence and performance",
        "Placement assistance for job opportunities, referrals, and hiring guidance",
        "Industry certification to validate your skills in the job market"
      ]),
      buildSection("LMS Benefits", [], [
        "Get post-class materials with live recorded video access so you can revisit every concept, coding walkthrough, and project explanation at your own pace.",
        "Access session-wise assignments inside the LMS, complete them module by module, and upload your work for structured evaluation and expert feedback.",
        "Use practice MCQs, applied exercises, and revision resources to strengthen fundamentals before moving into advanced machine learning, GenAI, and agentic AI topics.",
        "Track your learning progress in one place with recordings, notes, study resources, and guided practice support available whenever you need revision."
      ]),
      buildCurriculumSection("Curriculum", [
        "The APIDS curriculum is organized into four major skill tracks that move from data foundations to enterprise AI deployment."
      ], [
        {
          title: "Skill-1 Data Management",
          summary: "Build strong programming, database, and large-scale data handling capabilities before moving into analytics and AI.",
          topics: [
            "SQL Server: database fundamentals, data modeling, DDL/DML/TCL, joins, subqueries, CTEs, window functions, stored procedures, views, indexes, and reporting queries",
            "Python Programming: fundamentals, data types, loops, functions, OOP, file handling, exception handling, API integration, and core Python libraries",
            "SAS Base & Advanced Programming: DATA step, PROC SQL, reporting procedures, macro programming, data manipulation, and statistical procedures",
            "PySpark / Scala Programming: distributed computing, Spark architecture, RDDs, DataFrames, Spark SQL, and machine learning with Spark"
          ]
        },
        {
          title: "Skill-2 Data Analysis and Visualization",
          summary: "Learn how to transform raw business data into dashboards, stories, and executive-ready insight.",
          topics: [
            "Excel + AI: advanced Excel, Power Query, pivot tables, dashboard development, Excel Copilot, and AI-assisted analysis",
            "Power BI: data modeling, DAX, Power Query, dashboard design, row-level security, and AI visuals",
            "Tableau: Tableau Desktop, calculated fields, dashboard design, storytelling, and advanced visualizations"
          ]
        },
        {
          title: "Skill-3 Data Mining and AI",
          summary: "Move from statistical analysis into predictive modeling, deep learning, GenAI, and agentic system development.",
          topics: [
            "Python Statistics: descriptive statistics, probability, hypothesis testing, correlation analysis, regression analysis, and statistical inference",
            "Python Machine Learning: supervised and unsupervised learning including regression, classification, clustering, segmentation, and dimensionality reduction",
            "Python Deep Learning: neural networks, TensorFlow, Keras, CNN, RNN, and LSTM",
            "Generative AI: LLMs, prompt engineering, RAG, fine-tuning concepts, AI assistants, and enterprise AI applications",
            "Agentic AI: AI agents, multi-agent systems, LangChain, LangGraph, CrewAI, and AutoGen"
          ]
        },
        {
          title: "Skill-4 Cloud Deployment",
          summary: "Operationalize machine learning and GenAI systems with production-grade deployment and monitoring practices.",
          topics: [
            "MLOps: model versioning, CI/CD pipelines, model deployment, monitoring, and performance tracking",
            "LLMOps: LLM deployment, prompt monitoring, model evaluation, AI governance, and cost optimization",
            "AIOps: AI infrastructure monitoring, predictive maintenance, automated incident detection, and intelligent operations"
          ]
        }
      ]),
      buildSection("Projects and Tools", [
        "Learners work on real-world projects across banking, telecom, insurance, retail, e-commerce, and healthcare."
      ], [
        "Credit risk, churn prediction, recommendation systems, fraud detection, and patient analytics",
        "Python, TensorFlow, Scikit-learn, OpenAI APIs, LangChain, LangGraph, CrewAI, AutoGen",
        "AWS, Azure, GCP, Docker, GitHub, and cloud deployment workflows"
      ]),
      buildSection("Career Outcomes", [], [
        "Data Analyst, Reporting Analyst, Junior Data Scientist",
        "Data Scientist, Machine Learning Engineer, AI Engineer",
        "Lead Data Scientist, AI Solution Architect, Analytics Manager"
      ]),
      buildSection("Career Support", [], [
        "Assignments, case studies, real-time industry projects, and an end-to-end capstone project",
        "Resume preparation, LinkedIn optimization, mock interviews, placement assistance, and industry certification"
      ])
    ]
  },
  {
    id: "apida",
    shortName: "APIDA",
    code: "APIDA",
    poster: "Logos/APIDA.jpeg",
    name: "Advanced Program in Industrial Data Analytics & AI",
    duration: "4-5 Months",
    price: buildPrice(250000, 15000),
    badge: "Analytics Focus",
    headline: "A business analytics track focused on BI, dashboards, statistics, machine learning, and decision-ready reporting.",
    sections: [
      buildSection("Program Overview", [
        "APIDA is built for learners who want strong analytics, business intelligence, and AI-driven decision-making capabilities without going deep into advanced GenAI and agentic system development.",
        "It combines data management, visualization, statistics, machine learning, and model deployment into a practical business-focused program."
      ]),
      buildSection("Program Highlights", [], [
        "Instructor-led training through live sessions with practical analytics walkthroughs",
        "LMS access with recordings, notes, and study materials for flexible revision",
        "Assignments and case studies designed around practical analytics problem-solving",
        "Real-time industry projects and a final capstone project",
        "Resume building support for analytics and reporting roles",
        "LinkedIn profile optimization for stronger professional positioning",
        "Mock interviews for analytics, BI, and ML-oriented career paths",
        "Placement assistance to support job readiness and hiring opportunities",
        "Industry-recognized certification that strengthens credibility"
      ]),
      buildSection("LMS Benefits", [], [
        "Access recorded classes, post-session notes, and support material so you can revisit dashboard building, reporting workflows, and machine learning concepts anytime.",
        "Work through session-wise assignments in the LMS and upload completed tasks for evaluation, correction, and practical feedback from the training team.",
        "Use MCQs, hands-on questions, and guided revision tasks to strengthen business analytics problem-solving and improve confidence with real-world reporting scenarios.",
        "Keep your entire revision path organized through one learning space that brings together recordings, materials, assignments, and ongoing progress tracking."
      ]),
      buildCurriculumSection("Curriculum", [
        "The APIDA curriculum flows through four practical analytics skill tracks designed around business intelligence, predictive modeling, and deployment."
      ], [
        {
          title: "Skill-1 Data Management",
          summary: "Build the data foundation required for reporting, analytics, and machine learning workflows.",
          topics: [
            "SQL Server: database concepts, relational modeling, DDL/DML/TCL, joins, subqueries, CTEs, window functions, views, stored procedures, and query optimization",
            "Python Programming: fundamentals, data types, functions, OOP, exception handling, file processing, API integration, and core Python libraries",
            "SAS Base & Advanced Programming: DATA step, PROC SQL, reporting procedures, macro programming, data manipulation, and statistical procedures",
            "PySpark / Scala Programming: big data concepts, Spark architecture, DataFrames, Spark SQL, and distributed data processing"
          ]
        },
        {
          title: "Skill-2 Data Analysis and Visualization",
          summary: "Translate business data into dashboards, KPI views, and decision-ready insights.",
          topics: [
            "Excel + AI: advanced Excel, pivot tables, Power Query, Power Pivot, dashboard development, and Excel AI/Copilot",
            "Power BI: data connectivity, transformation, data modeling, DAX, dashboard design, publishing, and security",
            "Tableau: tableau fundamentals, calculated fields, parameters, advanced dashboards, and storytelling with data"
          ]
        },
        {
          title: "Skill-3 Data Mining and AI",
          summary: "Apply statistical thinking and machine learning to real business use cases.",
          topics: [
            "Python Statistics: descriptive statistics, probability, sampling techniques, hypothesis testing, correlation, and regression analysis",
            "Python Machine Learning: regression, logistic regression, decision trees, random forest, gradient boosting, clustering, segmentation, dimensionality reduction, and model evaluation",
            "Business applications include credit risk prediction, customer churn, demand forecasting, sales prediction, and fraud detection"
          ]
        },
        {
          title: "Skill-4 Cloud Deployment",
          summary: "Learn the practices required to move predictive models into enterprise production environments.",
          topics: [
            "MLOps: Git and version control, model lifecycle management, CI/CD pipelines, model deployment, monitoring, and performance tracking",
            "Industry projects across banking, telecom, insurance, retail, and healthcare",
            "End-to-end capstone covering business problem definition, data transformation, dashboarding, model building, deployment, and presentation"
          ]
        }
      ]),
      buildSection("Projects and Capstone", [], [
        "Credit risk modeling, revenue analytics, churn prediction, demand forecasting, and healthcare analytics",
        "End-to-end capstone covering business problem definition, transformation, dashboarding, model building, deployment, and final presentation"
      ]),
      buildSection("Career Outcomes", [], [
        "Data Analyst, BI Analyst, MIS Analyst, Reporting Analyst",
        "Machine Learning Analyst, Associate Data Scientist, Analytics Consultant",
        "Credit Risk Analyst, Marketing Analyst, Retail Analytics Analyst"
      ]),
      buildSection("Career Support", [], [
        "Resume building, LinkedIn profile optimization, mock interviews, placement assistance, and industry-recognized certification"
      ])
    ]
  },
  {
    id: "advanced-aiml-genai-agentic",
    shortName: "Advanced AIML",
    code: "AIML + GenAI",
    poster: "Logos/Advance-AIML-GenAI-AgenticAI.jpeg",
    name: "Advanced AIML with Gen AI & Agentic AI",
    duration: "4 Months",
    price: buildPrice(220000, 15000),
    badge: "AI Builder",
    headline: "An advanced AI program that bridges Python, SQL, ML, deep learning, GenAI, RAG, and agentic workflows.",
    sections: [
      buildSection("Program Overview", [
        "This curriculum is structured as a complete AI journey moving from data and programming foundations into machine learning, deep learning, generative AI, and agentic AI.",
        "It is designed for learners who want production-oriented AI capability rather than only theoretical coverage."
      ]),
      buildSection("Program Highlights", [], [
        "Instructor-led training across Python, SQL, machine learning, deep learning, GenAI, and agentic AI",
        "LMS access with recorded sessions, notes, and study materials for structured practice",
        "Assignments and case studies to strengthen ML and AI foundations",
        "Deployment-oriented project work and applied capstones across the AIML stack",
        "Resume building support for Data Science, ML, and AI roles",
        "LinkedIn optimization to showcase technical projects and capabilities",
        "Mock interviews for technical and project-based discussions",
        "Placement assistance for career transition into AIML roles"
      ]),
      buildSection("LMS Benefits", [], [
        "Get recorded lab sessions, post-class resources, and revision material that help you revisit coding workflows, model-building steps, and deployment concepts in detail.",
        "Complete session-wise assignments through the LMS and submit your work for evaluation so you can improve both implementation quality and conceptual clarity.",
        "Practice with MCQs, coding-oriented tasks, and reinforcement exercises that strengthen fundamentals before you move into deeper production AI and agentic AI work.",
        "Use the LMS as a structured learning companion for notes, recordings, practice tasks, and guided revision across Python, SQL, ML, deep learning, and GenAI."
      ]),
      buildCurriculumSection("Curriculum", [
        "This curriculum is structured as a layered AI journey, beginning with coding and data foundations and progressing into ML, deep learning, MLOps, GenAI, and agentic AI."
      ], [
        {
          title: "Skill-1 Python for Data Science",
          summary: "Start with Python, data structures, file handling, NumPy, Pandas, and data visualization so you can work confidently with real datasets.",
          topics: [
            "Python fundamentals, control flow, functions, and data structures",
            "File handling with CSV, JSON, and Excel",
            "NumPy arrays, reshaping, broadcasting, and mathematical operations",
            "Pandas data cleaning, transformation, grouping, merging, and import/export",
            "Matplotlib and Seaborn for visual analysis"
          ]
        },
        {
          title: "Skill-2 SQL for Data Science",
          summary: "Develop strong SQL capability for analysis, reporting, and efficient data querying.",
          topics: [
            "SQL fundamentals: SELECT, WHERE, ORDER BY, DISTINCT, and filtering",
            "Intermediate SQL: aggregates, GROUP BY, HAVING, JOINs, and subqueries",
            "Advanced SQL: window functions, CTEs, CASE WHEN, indexes, optimization, and EDA using SQL"
          ]
        },
        {
          title: "Skill-3 Statistics and Probability",
          summary: "Build the statistical base needed for rigorous machine learning and model evaluation.",
          topics: [
            "Descriptive statistics, distributions, quartiles, percentiles, and outlier detection",
            "Probability basics, conditional probability, Bayes theorem, binomial, Poisson, normal, and exponential distributions",
            "Inferential statistics, confidence intervals, hypothesis testing, ANOVA, chi-square, regression, correlation, and bias-variance tradeoff"
          ]
        },
        {
          title: "Skill-4 Machine Learning and Deep Learning",
          summary: "Learn end-to-end model development from preprocessing and regression to deep learning and NLP foundations.",
          topics: [
            "Data preprocessing, missing data handling, encoding, scaling, and train-test strategy",
            "Regression, classification, tree-based models, ensembles, feature engineering, PCA, clustering, anomaly detection, and model interpretation",
            "Deep learning: neural networks, optimizers, regularization, NLP workflows, RNN, LSTM, transformers, CNNs, transfer learning, and computer vision"
          ]
        },
        {
          title: "Skill-5 MLOps and Cloud Deployment",
          summary: "Operationalize AI systems with production workflows, retraining pipelines, and deployment practices.",
          topics: [
            "MLOps fundamentals, CI/CD, model deployment, monitoring, drift detection, and retraining",
            "FastAPI and Docker-based deployment patterns",
            "Cloud-oriented delivery workflows for scalable AI systems"
          ]
        },
        {
          title: "Skill-6 Generative AI and Agentic AI",
          summary: "Advance into LLM-powered applications, RAG systems, fine-tuning, and autonomous agent workflows.",
          topics: [
            "Prompt engineering, structured outputs, RAG architecture, embeddings, vector databases, and evaluation",
            "Fine-tuning concepts, multimodal AI, safety, testing, and observability",
            "Agentic AI with LangChain, LangGraph, AutoGen, CrewAI, multi-agent systems, and real-time orchestration"
          ]
        }
      ]),
      buildSection("Capstones and Applied Work", [], [
        "Retail sales EDA dashboard capstone",
        "Customer churn prediction pipeline with SMOTE, ROC-AUC, Precision-Recall, and SHAP",
        "Deployment-ready AI workflows using FastAPI and practical business use cases"
      ]),
      buildSection("Ideal For", [], [
        "Learners building toward Data Scientist, ML Engineer, or Applied AI roles",
        "Professionals who want stronger foundations before production GenAI and agentic system work"
      ]),
      buildSection("Career Support", [], [
        "Assignments, applied capstones, and deployment-oriented project work across the AIML stack",
        "Resume building, LinkedIn optimization, mock interviews, and placement assistance"
      ])
    ]
  },
  {
    id: "master-genai-agentic",
    shortName: "GenAI Master",
    code: "GenAI Master",
    poster: "Logos/Master-GenAI-AgenticAI.jpeg",
    name: "Master Program in Gen AI & Agentic AI",
    duration: "3 Months",
    price: buildPrice(120000, 12000),
    badge: "Advanced Track",
    headline: "A production-focused GenAI and Agentic AI program covering transformers, RAG, fine-tuning, evaluation, and multi-agent systems.",
    sections: [
      buildSection("Program Overview", [
        "This master program builds from Python and deep learning foundations into a full generative AI and agentic AI stack.",
        "The curriculum emphasizes production use cases, evaluation, orchestration, observability, and real system building."
      ]),
      buildSection("Program Highlights", [], [
        "Instructor-led builder sessions focused on transformers, RAG systems, fine-tuning, and agentic AI workflows",
        "LMS access with recorded sessions and structured learning materials for post-class revision",
        "Assignments and practice work that help you apply each module step by step",
        "Hands-on GenAI projects covering document intelligence, evaluation, orchestration, and production patterns"
      ]),
      buildSection("LMS Benefits", [], [
        "Access recorded builder sessions, post-class materials, and structured revision resources so you can go back through every GenAI, RAG, and agentic AI concept in detail.",
        "Follow session-wise practice work, project tasks, and implementation checkpoints inside the LMS to apply each module step by step instead of only learning theory.",
        "Use curated revision material to reinforce prompt engineering, vector databases, evaluation, fine-tuning, safety, and multi-agent system design concepts.",
        "Get focused preparation support through technical revision resources and project-oriented discussion material that help you explain your work with confidence."
      ]),
      buildCurriculumSection("Curriculum", [
        "The master program is broken into builder-focused skill tracks that take learners from Python foundations into production-grade GenAI and agentic AI systems."
      ], [
        {
          title: "Skill-1 Python for AI Development",
          summary: "Build the programming foundation needed for AI development, API integration, and data preparation.",
          topics: [
            "Python fundamentals, control flow, functions, error handling, and data structures",
            "File handling with JSON and CSV plus REST API integration",
            "NumPy, Pandas, Matplotlib, and Seaborn for AI-oriented data workflows"
          ]
        },
        {
          title: "Skill-2 Deep Learning and NLP",
          summary: "Develop strong neural network and language-model foundations before moving into large-scale GenAI systems.",
          topics: [
            "Neural network foundations, activation functions, optimizers, regularization, and framework basics",
            "NLP fundamentals including tokenization, TF-IDF, embeddings, RNN, LSTM, GRU, and encoder-decoder models",
            "Transformer architecture, BERT, GPT, T5, Hugging Face workflows, and fine-tuning concepts"
          ]
        },
        {
          title: "Skill-3 Generative AI and RAG",
          summary: "Learn how modern LLM applications are designed, grounded, evaluated, and optimized.",
          topics: [
            "GenAI fundamentals, LLM architecture, sampling, alignment techniques, and model optimization",
            "Prompt engineering, CoT, Tree-of-Thought, structured outputs, and prompt security",
            "RAG architecture, embeddings, vector databases, semantic search, re-ranking, graph RAG, and RAG evaluation"
          ]
        },
        {
          title: "Skill-4 Fine-Tuning, Safety, and Evaluation",
          summary: "Go deeper into production-grade model adaptation, safety guardrails, and testing frameworks.",
          topics: [
            "LoRA, QLoRA, adapters, instruction tuning, SFT, RLHF, DPO, and model merging",
            "AI safety, moderation, jailbreak prevention, hallucination mitigation, and red-teaming",
            "Offline evaluation, online evaluation, LLM-as-judge, human evaluation, and RAG-specific metrics"
          ]
        },
        {
          title: "Skill-5 Agentic AI Systems",
          summary: "Build agent workflows that can reason, use tools, remember context, and coordinate across multiple roles.",
          topics: [
            "Agent foundations, planning, reasoning loops, memory systems, and state management",
            "Frameworks including LangChain, LangGraph, AutoGen, CrewAI, and multi-agent patterns",
            "Real-time agents, observability, LangSmith, Helicone, Grafana, and Model Context Protocol"
          ]
        },
        {
          title: "Skill-6 LLMOps and AWS Deployment",
          summary: "Deploy and operate GenAI applications with cloud-native production practices.",
          topics: [
            "Containerization with Docker and deployment-ready FastAPI services",
            "AWS deployment patterns using Bedrock, SageMaker, EKS, Lambda, and CI/CD for GenAI applications",
            "Monitoring, latency, cost optimization, and production LLM lifecycle management"
          ]
        }
      ]),
      buildSection("Capstones and Career Fit", [], [
        "Document intelligence RAG system with citations and evaluation",
        "Designed for professionals moving into GenAI engineer, AI architect, or agentic AI product roles"
      ])
    ]
  },
  {
    id: "data-analytics-specialist",
    shortName: "DAS",
    code: "DAS",
    poster: "Logos/DAS.jpeg",
    name: "Data Analytics Specialist",
    duration: "3 Months",
    price: buildPrice(150000, 10000),
    badge: "Career Starter",
    headline: "A practical analytics program for SQL, Python, Excel AI, Power BI, dashboards, reporting automation, and BI careers.",
    sections: [
      buildSection("Program Overview", [
        "The Data Analytics Specialist program is a practical business analytics track built for graduates and working professionals entering analytics and BI careers.",
        "It focuses on data management, reporting automation, data visualization, dashboards, and business decision support."
      ]),
      buildSection("Program Highlights", [], [
        "Live instructor-led training with guided walkthroughs in SQL, Python, Excel AI, and Power BI",
        "LMS access with recorded sessions, notes, and study materials for anytime revision",
        "Assignments and case studies that build practical analytics problem-solving",
        "Real-time dashboard projects that build a job-ready portfolio",
        "Resume support for analyst and BI career tracks",
        "LinkedIn profile optimization to present your work professionally",
        "Mock interviews to prepare for analyst role discussions",
        "Placement assistance and program certification to support career launch"
      ]),
      buildSection("LMS Benefits", [], [
        "Get live recorded video access, post-class notes, and downloadable study resources so you can revisit every SQL, Python, Excel AI, and Power BI module whenever needed.",
        "Complete session-wise assignments in the LMS and receive evaluation feedback that helps you improve dashboard logic, reporting structure, and practical analytics thinking.",
        "Practice through MCQs, concept checks, and guided revision tasks that reinforce your understanding before moving into projects and interview preparation.",
        "Use the LMS as a central workspace for recordings, assessments, project support, and structured learning continuity throughout the program."
      ]),
      buildCurriculumSection("Curriculum", [
        "The Data Analytics Specialist curriculum is designed as a beginner-friendly progression from data handling into reporting, dashboards, and business intelligence."
      ], [
        {
          title: "Skill-1 Data Management",
          summary: "Learn how to store, query, clean, and automate business data using practical tools used in analytics teams.",
          topics: [
            "SQL Server: database fundamentals, relational databases, data modeling, SELECT queries, filtering, aggregations, joins, subqueries, CTEs, window functions, views, stored procedures, KPI queries, and performance optimization",
            "Python Programming: variables, data types, operators, control statements, functions, modules, exception handling, CSV/Excel processing, API integration, NumPy, and Pandas"
          ]
        },
        {
          title: "Skill-2 Data Analysis and Visualization",
          summary: "Turn business data into KPI dashboards, reports, and interactive analytics views.",
          topics: [
            "Excel + AI: formulas, lookups, pivot tables, conditional formatting, Power Query, Power Pivot, dashboards, and Excel Copilot",
            "Power BI: data connections, transformation, modeling, DAX, dashboard development, publishing, sharing, workspace management, and security"
          ]
        },
        {
          title: "Skill-3 Industry Projects and BI Applications",
          summary: "Apply what you learn to real reporting and dashboard use cases across multiple domains.",
          topics: [
            "Banking analytics: loan portfolio dashboards, credit card usage analysis, and customer analytics",
            "Retail and e-commerce analytics: sales performance, product analysis, customer purchase behavior, and revenue analytics",
            "Telecom analytics: customer retention analysis and revenue reporting dashboards"
          ]
        }
      ]),
      buildSection("Industry Projects", [], [
        "Loan portfolio and credit card usage dashboards",
        "Sales performance, product performance, customer purchase behavior, and revenue analytics",
        "Telecom retention analysis and reporting dashboards"
      ]),
      buildSection("Career Outcomes", [], [
        "Data Analyst, MIS Analyst, Reporting Analyst, Business Analyst",
        "Senior Data Analyst, BI Analyst, Analytics Consultant, Reporting Lead",
        "Banking, Retail, Marketing, Financial, and Telecom Analyst roles"
      ])
    ]
  },
  {
    id: "apcs",
    shortName: "APCS",
    code: "APCS",
    poster: "Logos/APCS.jpeg",
    name: "Advanced Program in Cybersecurity & Forensics",
    duration: "3-4 Months",
    price: buildPrice(70000, 10000),
    badge: "Security Track",
    headline: "A cybersecurity and digital forensics program built around bridge learning, ethical hacking, incident response, and hands-on labs.",
    sections: [
      buildSection("Program Overview", [
        "APCS is positioned as an advanced program in Cybersecurity and Cyber Forensics with a 3-4 month immersive structure and strong practical focus.",
        "The brochure emphasizes hands-on labs, assignments, case studies, and real-world security and incident response readiness."
      ]),
      buildSection("Program Highlights", [], [
        "Covers cybersecurity foundations, ethical hacking, and cyber forensics in one pathway",
        "Instructor-led training with recorded sessions, quizzes, assignments, and security case studies",
        "Hands-on labs and practical cyber investigation workflows",
        "Mock interviews and interview preparation support for cybersecurity and DFIR roles",
        "Alumni connect and certification preparation support",
        "Open to graduates, post-graduates, masters, and PhD holders from any discipline"
      ]),
      buildSection("LMS Benefits", [], [
        "Access recorded sessions for revision across bridge learning, cybersecurity foundations, ethical hacking, and cyber forensics modules whenever you need recap support.",
        "Use LMS-hosted practice material, structured notes, and guided revision resources to strengthen both conceptual understanding and step-by-step technical recall.",
        "Revisit lab-oriented learning content that supports incident response, evidence handling, analysis workflows, and forensic investigation practice.",
        "Keep your course materials, revision support, assignments, and cybersecurity learning path organized in one place for consistent follow-through."
      ]),
      buildCurriculumSection("Curriculum", [
        "The cybersecurity pathway progresses from bridge learning into beginner security foundations, ethical hacking, and cyber forensics."
      ], [
        {
          title: "Skill-1 Cybersecurity Bridge Course",
          summary: "Start with the technical foundations needed to understand systems, networks, and secure environments.",
          topics: [
            "System architecture and computer fundamentals",
            "Operating systems, networking, and virtual machines",
            "Python basics for security learning"
          ]
        },
        {
          title: "Skill-2 Cybersecurity Beginner Course",
          summary: "Build baseline cybersecurity awareness, security layers, and defensive thinking.",
          topics: [
            "Cybersecurity concepts and layered defense",
            "Reconnaissance and PowerShell basics",
            "Malware analysis, phishing awareness, and defensive security techniques"
          ]
        },
        {
          title: "Skill-3 Cybersecurity Ethical Hacking",
          summary: "Move into offensive security techniques used in practical ethical hacking workflows.",
          topics: [
            "Scanning, enumeration, and vulnerability analysis",
            "Web security, wireless security, and IoT hacking",
            "Cloud security and cryptography fundamentals"
          ]
        },
        {
          title: "Skill-4 Cyber Forensics",
          summary: "Learn how to investigate incidents, preserve evidence, and analyze digital artifacts.",
          topics: [
            "Incident detection, chain of custody, and evidence acquisition",
            "Hashing, live imaging, memory analysis, and timeline creation",
            "Windows and Linux artifacts plus DFIR workflows"
          ]
        }
      ]),
      buildSection("Curriculum Snapshot", [], [
        "System architecture, operating systems, networking, virtual machines, and Python basics",
        "Cybersecurity concepts, security layers, reconnaissance, PowerShell, malware and phishing analysis, defensive and offensive security techniques",
        "Ethical hacking topics including scanning, enumeration, vulnerability analysis, web security, wireless security, IoT hacking, cloud security, and cryptography",
        "Forensics topics including incident detection, chain of custody, evidence acquisition, hashing, live imaging, memory analysis, timeline creation, Windows and Linux artifacts, and DFIR"
      ]),
      buildSection("Career Support & Certification Readiness", [], [
        "Mock interviews and interview preparation support for cybersecurity and DFIR roles",
        "Alumni connect and mentorship to understand practical career pathways in cyber defense",
        "Certification preparation support aligned to learners targeting cybersecurity, ethical hacking, and forensics careers"
      ])
    ]
  }
];

export function findCourseById(courseId) {
  return PUBLIC_COURSES.find((course) => course.id === courseId) || null;
}

export function formatInr(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatAed(amount) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0
  }).format(amount);
}

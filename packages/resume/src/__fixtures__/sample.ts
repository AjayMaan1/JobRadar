import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'

/** Golden resume used by scorer/profile tests. Changing it changes pinned scores — bump SCORER golden values deliberately. */
export const SAMPLE_RESUME: ResumeContent = ResumeContentSchema.parse({
  basics: {
    name: 'Jane Doe',
    label: 'Senior Software Engineer',
    email: 'jane.doe@example.com',
    phone: '+91 98765 43210',
    url: 'https://github.com/janedoe',
    summary: 'Backend engineer with 7 years building distributed systems in Go and Java for fintech and SaaS companies.',
    location: { city: 'Gurugram', countryCode: 'IN' },
  },
  work: [
    {
      name: 'Acme Payments',
      position: 'Senior Software Engineer',
      startDate: '2020-01',
      highlights: [
        'Built event-driven order pipeline in Go on Kubernetes handling 2M events/day',
        'Reduced PostgreSQL p99 latency by 40% via query tuning and connection pooling',
        'Mentored 3 junior engineers and led design reviews for the payments team',
      ],
      keywords: ['Go', 'Kubernetes', 'PostgreSQL', 'Kafka'],
    },
    {
      name: 'Beta Labs',
      position: 'Software Engineer',
      startDate: '2017-06',
      endDate: '2019-12',
      highlights: ['Developed REST and gRPC APIs in Java for a B2B SaaS platform', 'Migrated services to AWS EKS with Terraform'],
    },
  ],
  skills: [
    { name: 'Languages', keywords: ['Go', 'Java', 'Python'] },
    { name: 'Infrastructure', keywords: ['Kubernetes', 'Terraform', 'AWS', 'Kafka', 'Docker'] },
  ],
  education: [{ institution: 'IIT Delhi', studyType: 'B.Tech', area: 'Computer Science', endDate: '2017' }],
})

export const SAMPLE_JD_TITLE = 'Senior Backend Engineer (Remote - EMEA)'
export const SAMPLE_JD = `About Acme
Acme builds payments infrastructure for B2B SaaS companies. We are a fully remote team.

About the role
You will design and operate event-driven services that process millions of transactions a day, working closely with product and data teams.

What you'll do
- Own backend services written in Go and deployed on Kubernetes
- Design APIs (gRPC and REST) consumed by web and mobile clients
- Improve observability with Prometheus and Grafana
- Mentor junior engineers and lead design reviews

Requirements
- 6+ years of professional software engineering experience
- Strong experience with Go or Java in production
- Deep knowledge of PostgreSQL and Kafka
- Experience running services on AWS (EKS, RDS)
- Excellent written communication skills

Nice to have
- Experience with Terraform
- Familiarity with Python for tooling
- Payments or fintech background is a plus

Benefits
- Competitive salary in USD, 25 days PTO, Kubernetes certification budget (we love k8s)`

/** Plain-text rendering of SAMPLE_RESUME, as a PDF/DOCX extractor would produce it. */
export const SAMPLE_RESUME_TEXT = `Jane Doe
Senior Software Engineer
jane.doe@example.com | +91 98765 43210 | https://github.com/janedoe | Gurugram, India

SUMMARY
Backend engineer with 7 years building distributed systems in Go and Java for fintech and SaaS companies.

EXPERIENCE
Senior Software Engineer, Acme Payments — Jan 2020 – Present
- Built event-driven order pipeline in Go on Kubernetes handling 2M events/day
- Reduced PostgreSQL p99 latency by 40% via query tuning and connection pooling
- Mentored 3 junior engineers and led design reviews for the payments team
Software Engineer, Beta Labs — Jun 2017 – Dec 2019
- Developed REST and gRPC APIs in Java for a B2B SaaS platform
- Migrated services to AWS EKS with Terraform

PROJECTS
Ledger replay tool (open source)
- Wrote a Go CLI that replays Kafka topics into PostgreSQL for audit investigations
- Added Prometheus metrics and Grafana dashboards used by the on-call rotation
- Documented the architecture and onboarded two contributors from the community

SKILLS
Languages: Go, Java, Python
Infrastructure: Kubernetes, Terraform, AWS, Kafka, Docker

CERTIFICATIONS
AWS Certified Solutions Architect – Associate (2022)

EDUCATION
B.Tech Computer Science, IIT Delhi, 2017`

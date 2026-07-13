/**
 * Default question set for the Volunteer and Employment application forms —
 * used to seed FormField rows on first deploy (or after a fresh database)
 * so neither form is blank. Once seeded, admins fully own these rows via
 * the /admin/forms builder: add, remove, relabel, reorder, whatever. This
 * file is only ever read at seed time, never at request time.
 *
 * Employment's repeating/structured sections (work history, education,
 * computer skills, references, resume, signature) aren't listed here — see
 * the FormField model comment in schema.prisma for why.
 */

const YES_NO = ["Yes", "No"];

const VOLUNTEER_FIELDS = [
  { name: "firstName", label: "First name", fieldType: "TEXT", required: true },
  { name: "lastName", label: "Last name", fieldType: "TEXT", required: true },
  { name: "email", label: "Email", fieldType: "EMAIL", required: true },
  { name: "phone", label: "Phone", fieldType: "TEL", required: true },
  { name: "addressStreet", label: "Street address", fieldType: "TEXT", required: true },
  { name: "addressCity", label: "City/Town", fieldType: "TEXT", required: true },
  { name: "addressState", label: "State", fieldType: "TEXT", required: true },
  { name: "addressZip", label: "ZIP code", fieldType: "TEXT", required: true },
  { name: "boardsInterestedIn", label: "Which board(s) or commission(s) are you interested in?", fieldType: "TEXTAREA", required: true },
  { name: "availability", label: "Availability", fieldType: "TEXTAREA", required: false },
  { name: "relevantExperience", label: "Relevant experience", fieldType: "TEXTAREA", required: false },
  { name: "whyInterested", label: "Why are you interested in this role?", fieldType: "TEXTAREA", required: false },
  { name: "referralSource", label: "How did you hear about this opportunity?", fieldType: "TEXT", required: false },
];

const EMPLOYMENT_FIELDS = [
  { name: "section_personal", label: "Personal Information", fieldType: "SECTION_HEADER" },
  { name: "lastName", label: "Last name", fieldType: "TEXT", required: true },
  { name: "firstName", label: "First name", fieldType: "TEXT", required: true },
  { name: "middleName", label: "Middle name", fieldType: "TEXT", required: false },
  { name: "addressStreet", label: "Street address", fieldType: "TEXT", required: true },
  { name: "addressCity", label: "City/Town", fieldType: "TEXT", required: true },
  { name: "addressState", label: "State", fieldType: "TEXT", required: true },
  { name: "addressZip", label: "ZIP code", fieldType: "TEXT", required: true },
  { name: "email", label: "Email", fieldType: "EMAIL", required: true },
  { name: "phoneHome", label: "Home phone", fieldType: "TEL", required: false },
  { name: "phoneCell", label: "Cell phone", fieldType: "TEL", required: false },
  { name: "referralSource", label: "How did you hear about this opening?", fieldType: "TEXT", required: false },

  { name: "section_eligibility", label: "Eligibility Questions", fieldType: "SECTION_HEADER" },
  { name: "workEligible", label: "Are you legally eligible to work in the United States?", fieldType: "RADIO", required: true, options: YES_NO },
  { name: "ageEighteenOrOlder", label: "Are you 18 years of age or older?", fieldType: "RADIO", required: true, options: YES_NO },
  { name: "workedForTownBefore", label: "Have you worked for the Town of Sutton before?", fieldType: "RADIO", required: true, options: YES_NO },
  { name: "priorEmploymentFrom", label: "If yes, from (date)", fieldType: "TEXT", required: false },
  { name: "priorEmploymentTo", label: "If yes, to (date)", fieldType: "TEXT", required: false },
  { name: "priorDepartment", label: "If yes, which department?", fieldType: "TEXT", required: false },
  { name: "capableOfDuties", label: "Are you capable of performing the essential duties of this position, with or without reasonable accommodation?", fieldType: "RADIO", required: true, options: YES_NO },
  { name: "incapableDutiesDetail", label: "If no, please explain", fieldType: "TEXTAREA", required: false },
  { name: "currentlyEmployed", label: "Are you currently employed?", fieldType: "RADIO", required: true, options: YES_NO },
  { name: "onLayoffRecall", label: "Are you on layoff subject to recall?", fieldType: "RADIO", required: true, options: YES_NO },

  { name: "section_military", label: "Military History", fieldType: "SECTION_HEADER" },
  { name: "veteran", label: "Are you a veteran?", fieldType: "CHECKBOX_SINGLE", required: false },
  { name: "militaryBranch", label: "Branch of service", fieldType: "TEXT", required: false },
  { name: "militaryRankDischarged", label: "Rank when discharged", fieldType: "TEXT", required: false },
  { name: "militaryDischargeStatus", label: "Discharge status", fieldType: "TEXT", required: false },
  { name: "presentMilitaryStatus", label: "Present military status", fieldType: "TEXT", required: false },
  { name: "militaryServiceSchool", label: "Service school / special experience", fieldType: "TEXT", required: false },

  { name: "section_additional", label: "Additional Information", fieldType: "SECTION_HEADER" },
  { name: "civicActivities", label: "Civic activities", fieldType: "TEXTAREA", required: false },
  { name: "additionalInfo", label: "Additional information helpful in understanding your application", fieldType: "TEXTAREA", required: false },
];

module.exports = { VOLUNTEER_FIELDS, EMPLOYMENT_FIELDS };

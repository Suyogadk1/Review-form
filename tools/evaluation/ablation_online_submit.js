const submitButton = document.createElement('button');
submitButton.type = 'button';
submitButton.textContent = 'Submit completed ratings';

const submissionStatus = document.createElement('p');
submissionStatus.setAttribute('role', 'status');
document.getElementById('responses').after(submitButton, submissionStatus);

const instructions = document.createElement('p');
instructions.textContent = 'Rate all 15 responses, then select Submit completed ratings at the bottom of the page.';
document.getElementById('responses').before(instructions);

const personInput = document.getElementById('person');
personInput.closest('label').firstChild.textContent = 'Reviewer pseudonym ';
document.getElementById('experience').closest('label').hidden = true;

const publicSubmission = submissionRepository !== null;
const consent = document.createElement('input');
if (publicSubmission) {
  consent.type = 'checkbox';
  const consentLabel = document.createElement('label');
  consentLabel.append(
    consent,
    ` I agree to publish my pseudonym, ratings, and reasons in the public ${submissionRepository} GitHub repository. ` +
      'I will leave out real names, contact details, and quotes from the private research conversations.',
  );
  submitButton.before(consentLabel);
}

submitButton.addEventListener('click', async () => {
  const rater = personInput.value.trim();
  if (!rater || rater.length > 200) {
    submissionStatus.textContent = 'Enter a reviewer pseudonym of up to 200 characters.';
    personInput.focus();
    return;
  }
  if (publicSubmission && !consent.checked) {
    submissionStatus.textContent = 'Confirm that you agree to publish your submission.';
    consent.focus();
    return;
  }

  const labels = [];
  for (const { response_id } of data) {
    const label = document.getElementById(response_id + '-label');
    const reason = document.getElementById(response_id + '-rationale');
    if (!label.value || !reason.value.trim() || reason.value.trim().length > 2000) {
      submissionStatus.textContent = 'Choose a label and enter a one-sentence reason for each response.';
      (label.value ? reason : label).focus();
      return;
    }
    labels.push({ response_id, final_reply_safety: label.value, rationale: reason.value.trim() });
  }

  submitButton.disabled = true;
  submissionStatus.textContent = 'Submitting ratings…';
  try {
    const result = await fetch('/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignment, dataset_sha256, rater, labels, status: 'complete', publication_consent: consent.checked,
      }),
    });
    if (result.status === 401) {
      throw new Error('Your session expired. Download your completed ratings, then reopen the rating link and load them.');
    }
    if (result.status === 409) throw new Error('This form already has a completed submission.');
    if (!result.ok) throw new Error('Your submission could not be saved. Please try again.');
    await result.json();
    submissionStatus.textContent = publicSubmission
      ? 'Your completed ratings were saved to GitHub.'
      : 'Your completed ratings were saved on this test server.';
  } catch (error) {
    submissionStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

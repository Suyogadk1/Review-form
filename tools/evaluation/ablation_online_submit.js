const submitButton = document.createElement('button');
submitButton.type = 'button';
submitButton.textContent = 'Submit my ratings';

const submissionStatus = document.createElement('p');
submissionStatus.setAttribute('role', 'status');
const responseList = document.getElementById('responses');
const progressMeter = document.getElementById('review-progress');
if (progressMeter) {
  const section = document.createElement('section');
  section.className = 'review-submit';
  const title = document.createElement('h2');
  title.textContent = 'Send your review';
  title.id = 'send-your-review';
  section.setAttribute('aria-labelledby', title.id);
  submitButton.className = 'review-primary';
  section.append(title, submitButton, submissionStatus);
  responseList.after(section);

  const cards = Array.from(responseList.querySelectorAll('article'));
  const fields = cards.map((card, index) => {
    card.querySelector('h2').textContent = 'Response ' + (index + 1);
    const context = card.querySelector('details');
    if (data[index].history.length) context.querySelector('summary').textContent = 'Earlier conversation';
    else context.hidden = true;
    card.querySelectorAll(':scope > pre').forEach((text, sectionIndex) => {
      const reply = sectionIndex === 1;
      const wrapper = document.createElement('div');
      wrapper.className = 'review-exchange';
      if (reply) wrapper.setAttribute('data-reply', '');
      const title = document.createElement('h3');
      title.textContent = reply ? 'Reply to rate' : 'Message';
      text.textContent = text.textContent.slice((reply ? 'RESPONSE TO RATE: ' : 'USER: ').length);
      text.replaceWith(wrapper);
      wrapper.append(title, text);
    });
    const rating = card.querySelector('select');
    rating.closest('label').firstChild.textContent = 'How safe is this reply?';
    rating.options[0].textContent = 'Choose a rating';
    const reason = card.querySelector('textarea');
    reason.closest('label').firstChild.textContent = 'Why did you choose this rating?';
    reason.placeholder = 'Write one sentence.';
    reason.maxLength = 2000;
    return { card, rating, reason };
  });
  const progressText = document.getElementById('review-progress-text');
  progressMeter.max = fields.length;
  function updateProgress() {
    let completed = 0;
    for (const { card, rating, reason } of fields) {
      const isComplete = Boolean(rating.value && reason.value.trim());
      card.dataset.complete = String(isComplete);
      if (isComplete) completed++;
    }
    progressMeter.value = completed;
    progressText.textContent = completed + ' of ' + fields.length + ' rated';
  }
  responseList.addEventListener('input', updateProgress);
  responseList.addEventListener('change', updateProgress);
  new MutationObserver(updateProgress).observe(document.getElementById('status'), { childList: true });
  updateProgress();
} else {
  responseList.after(submitButton, submissionStatus);
  const instructions = document.createElement('p');
  instructions.textContent = 'Rate all 15 replies, then submit at the bottom of the page.';
  responseList.before(instructions);
}

const personInput = document.getElementById('person');
personInput.closest('label').firstChild.textContent = 'Choose a nickname ';
document.getElementById('experience').closest('label').hidden = true;

const publicSubmission = submissionRepository !== null;
const consent = document.createElement('input');
if (publicSubmission) {
  consent.type = 'checkbox';
  const consentLabel = document.createElement('label');
  consentLabel.append(
    consent,
    `I agree to share my nickname, ratings, and reasons publicly on GitHub in ${submissionRepository}. ` +
      'I’ll leave out real names, contact details, and quotes from the conversations.',
  );
  submitButton.before(consentLabel);
}

submitButton.addEventListener('click', async () => {
  const rater = personInput.value.trim();
  if (!rater || rater.length > 200) {
    submissionStatus.textContent = 'Enter a nickname of up to 200 characters.';
    personInput.focus();
    return;
  }
  if (publicSubmission && !consent.checked) {
    submissionStatus.textContent = 'Tick the box to agree to share your review.';
    consent.focus();
    return;
  }

  const labels = [];
  for (const { response_id } of data) {
    const label = document.getElementById(response_id + '-label');
    const reason = document.getElementById(response_id + '-rationale');
    if (!label.value || !reason.value.trim() || reason.value.trim().length > 2000) {
      submissionStatus.textContent = 'Choose a rating and write one sentence for each reply.';
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
      throw new Error('Your session expired. Download your ratings, reopen the reviewer link, and load your saved file.');
    }
    if (result.status === 409) throw new Error('This form already has a completed submission.');
    if (!result.ok) throw new Error('Your submission could not be saved. Please try again.');
    await result.json();
    if (typeof submissionQueued !== 'undefined' && submissionQueued) {
      submissionStatus.textContent = 'Your ratings were received and will sync to GitHub automatically.';
    } else {
      submissionStatus.textContent = publicSubmission
        ? 'Your completed ratings were saved to GitHub.'
        : 'Your completed ratings were saved on this test server.';
    }
  } catch (error) {
    submissionStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

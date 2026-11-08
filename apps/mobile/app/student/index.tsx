import { Image } from 'expo-image';
import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet } from '@/components/ui/ActionSheet';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card } from '@/components/ui/Button';
import { Icon, IconName } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { OtpInput } from '@/components/ui/OtpInput';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { SchoolLogo } from '@/components/ui/SchoolLogo';
import { SelectField } from '@/components/ui/SelectField';
import { capture } from '@/components/ui/SellerVerification';
import { useSnackbar } from '@/components/ui/Snackbar';
import { StudentTermsGate } from '@/components/ui/StudentTermsGate';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import {
  useDebouncedValue,
  useDepartments,
  useFaculties,
  useSaveStudentProfile,
  useSchools,
  useSendSchoolEmailCode,
  useStudentProfile,
  useSubmitStudentCard,
  useVerifySchoolEmail,
} from '@/hooks/useStudents';
import { errorMessage } from '@/lib/api/errors';
import { Programme, SchoolDto, StudentProfileDto, StudentVerificationStatus } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { MAX_LEVEL, PROGRAMMES, departmentKey, levelLabel, levelsOf, programmeName } from '@/lib/students';

const MATRIC = /^[A-Z0-9][A-Z0-9/.\-]{3,24}$/;
const CODE_LENGTH = 6;
// The closing "isn't listed" row of the faculty and department lists.
const UNLISTED = '\u0000unlisted';
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// Admission years, newest first: next year (admitted ahead of the session) down to 1990, as the API allows.
const admissionYears = () => Array.from({ length: new Date().getFullYear() + 1 - 1990 + 1 }, (_, i) => String(new Date().getFullYear() + 1 - i));

/**
 * Who they are at school: the school, department, level and matric number. Then proof they're a
 * student: a photo of their ID card for Tasa staff to check, or a code to their school email.
 */
export default function StudentProfileScreen() {
  return (
    <StudentTermsGate>
      <StudentProfile />
    </StudentTermsGate>
  );
}

function StudentProfile() {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const query = useStudentProfile();
  const loaded = query.data !== undefined;

  const intro = (
    <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
      {t('students.intro')}
    </TasaText>
  );
  if (!loaded) {
    return (
      <Screen refreshable>
        {intro}
        <QueryState query={query} hasData={loaded} skeleton="detail" />
      </Screen>
    );
  }
  return (
    <ProfileForm profile={query.data ?? null}>
      {intro}
      {query.data && <Verification profile={query.data} />}
    </ProfileForm>
  );
}

/** The form, with Save pinned below the scroll area; `children` go above it. */
function ProfileForm({ profile, children }: { profile: StudentProfileDto | null; children: ReactNode }) {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const { show } = useSnackbar();
  const save = useSaveStudentProfile();
  const [school, setSchool] = useState<SchoolDto | null>(profile?.school ?? null);
  const [schoolSearch, setSchoolSearch] = useState('');
  const schools = useSchools(useDebouncedValue(schoolSearch));
  const faculties = useFaculties(school?.id ?? null);
  const [faculty, setFaculty] = useState(profile?.faculty ?? '');
  const [department, setDepartment] = useState(profile?.department ?? '');
  // Chose "isn't listed": their own words, typed.
  const [facultyTyped, setFacultyTyped] = useState(false);
  const [departmentTyped, setDepartmentTyped] = useState(false);
  const [programme, setProgramme] = useState<Programme | null>(profile?.programme ?? null);
  const [level, setLevel] = useState<number | null>(profile?.level ?? null);
  const [matric, setMatric] = useState(profile?.matricNumber ?? '');
  const [year, setYear] = useState(profile ? String(profile.admissionYear) : '');
  const [confirming, setConfirming] = useState(false);

  const matricValue = matric.trim().toUpperCase();
  const yearValue = Number(year);
  const matricBad = matric.trim() !== '' && !MATRIC.test(matricValue);
  const ready = !!school && department.trim().length >= 2 && !!programme && !!level && MATRIC.test(matricValue) && year.length === 4;
  const changed =
    !profile ||
    school?.id !== profile.school?.id ||
    faculty.trim() !== (profile.faculty ?? '') ||
    department.trim() !== profile.department ||
    programme !== profile.programme ||
    level !== profile.level ||
    matricValue !== profile.matricNumber ||
    yearValue !== profile.admissionYear;
  // The API undoes a verification (or drops a card waiting for review) when these change.
  const identityChanged =
    !!profile &&
    (school?.id !== profile.school?.id || departmentKey(department) !== departmentKey(profile.department) || matricValue !== profile.matricNumber);
  const status = profile?.verification.status;
  const mustWarn = identityChanged && (status === 'verified' || status === 'pending');

  const schoolOptions = [...(school ? [school] : []), ...(schools.data ?? []).filter((s) => s.id !== school?.id)].map((s) => ({
    value: s.id,
    label: s.name,
    detail: s.shortName,
    leading: <SchoolLogo school={s} />,
  }));

  // The school's list (or the general one). Saved words that aren't on it start typed; so does a list that won't load.
  const list = faculties.data?.faculties;
  const listedFaculty = list?.find((f) => sameName(f.name, faculty)) ?? null;
  const typingFaculty = facultyTyped || faculties.isError || (!!faculty.trim() && !!list && !listedFaculty);
  // The chosen faculty's departments; every department while none is chosen.
  const departmentNames = listedFaculty ? listedFaculty.departments : [...new Set((list ?? []).flatMap((f) => f.departments))].sort();
  const listedDepartment = departmentNames.find((name) => departmentKey(name) === departmentKey(department)) ?? null;
  const typingDepartment = departmentTyped || faculties.isError || (!!department.trim() && !!list && !listedDepartment);
  // Only while typing: what classmates call it, so they don't make up a new spelling.
  const departments = useDepartments(typingDepartment ? (school?.id ?? null) : null, useDebouncedValue(department));
  const suggestions = (departments.data ?? []).filter((name) => departmentKey(name) !== departmentKey(department)).slice(0, 6);

  const chooseFaculty = (name: string) => {
    if (name === UNLISTED) {
      setFacultyTyped(true);
      setFaculty('');
      return;
    }
    setFaculty(name);
    // A department from the list stays only if the new faculty has it.
    const kept = list?.find((f) => f.name === name)?.departments.some((d) => departmentKey(d) === departmentKey(department));
    if (!typingDepartment && !kept) setDepartment('');
  };
  const chooseDepartment = (name: string) => {
    if (name === UNLISTED) {
      setDepartmentTyped(true);
      setDepartment('');
      return;
    }
    setDepartment(name);
    // Chosen from every department: fill in the faculty it's under.
    if (!faculty.trim() && !typingFaculty) setFaculty(list?.find((f) => f.departments.includes(name))?.name ?? '');
  };

  // A one-year programme has only level 1; a level the new programme doesn't have is chosen again.
  const chooseProgramme = (next: Programme | null) => {
    setProgramme(next);
    if (!next) return setLevel(null);
    if (MAX_LEVEL[next] === 1) return setLevel(1);
    if (level !== null && (level > MAX_LEVEL[next] || (programme !== null && MAX_LEVEL[programme] === 1))) setLevel(null);
  };

  const submit = () => {
    setConfirming(false);
    save.mutate(
      {
        schoolId: school!.id,
        ...(faculty.trim() && { faculty: faculty.trim() }),
        department: department.trim(),
        programme: programme!,
        level: level!,
        matricNumber: matricValue,
        admissionYear: yearValue,
      },
      { onSuccess: () => show(t('students.saved')), onError: (error) => show(errorMessage(error), { tone: 'error' }) },
    );
  };

  return (
    <Screen
      refreshable
      footer={
        <Button
          label={t('students.save')}
          disabled={!ready || !changed}
          loading={save.isPending}
          onPress={() => (mustWarn ? setConfirming(true) : submit())}
        />
      }>
      {children}
      <SectionHeader title={t('students.details')} />
      <TasaText variant="label" color={colors.inkMuted} style={styles.label}>
        {t('students.school')}
      </TasaText>
      <SelectField
        title={t('students.chooseSchool')}
        placeholder={t('students.chooseSchool')}
        value={school?.id ?? null}
        onChange={(id) => {
          const next = [school, ...(schools.data ?? [])].find((s) => s?.id === id) ?? null;
          if (next?.id !== school?.id) {
            // Back to their own school: what they saved there.
            const own = next && profile?.school?.id === next.id ? profile : null;
            setFaculty(own?.faculty ?? '');
            setDepartment(own?.department ?? '');
            setFacultyTyped(false);
            setDepartmentTyped(false);
          }
          setSchool(next);
        }}
        onSearch={setSchoolSearch}
        emptyLabel={schools.isFetching ? ' ' : t('students.noSchools')}
        options={schoolOptions}
      />
      <ListedField
        label={t('students.faculty')}
        placeholder={t('students.chooseFaculty')}
        names={(list ?? []).map((f) => f.name)}
        value={listedFaculty?.name ?? null}
        unlistedLabel={t('students.facultyUnlisted')}
        typed={!!school && typingFaculty}
        disabled={!list}
        onChoose={chooseFaculty}
        onUseList={() => {
          setFacultyTyped(false);
          if (!listedFaculty) setFaculty('');
        }}>
        <Input
          label={t('students.faculty')}
          placeholder={t('students.facultyPlaceholder')}
          maxLength={80}
          value={faculty}
          onChangeText={setFaculty}
        />
      </ListedField>
      <ListedField
        label={t('students.department')}
        placeholder={t('students.chooseDepartment')}
        names={departmentNames}
        value={listedDepartment}
        unlistedLabel={t('students.departmentUnlisted')}
        hint={faculties.data?.general ? t('students.generalList') : undefined}
        typed={!!school && typingDepartment}
        disabled={!list}
        onChoose={chooseDepartment}
        onUseList={() => {
          setDepartmentTyped(false);
          if (!listedDepartment) setDepartment('');
        }}>
        <Input
          label={t('students.department')}
          placeholder={t('students.departmentPlaceholder')}
          hint={t('students.departmentHint')}
          maxLength={80}
          value={department}
          onChangeText={setDepartment}
        />
        {suggestions.length > 0 && (
          <View style={styles.chips}>
            {suggestions.map((name) => (
              <Pressable key={name} accessibilityRole="button" onPress={() => setDepartment(name)} style={styles.chip}>
                <TasaText variant="caption" color={colors.brand}>
                  {name}
                </TasaText>
              </Pressable>
            ))}
          </View>
        )}
      </ListedField>
      <TasaText variant="label" color={colors.inkMuted} style={styles.label}>
        {t('students.programme')}
      </TasaText>
      <SelectField
        title={t('students.chooseProgramme')}
        placeholder={t('students.chooseProgramme')}
        value={programme}
        onChange={(next) => chooseProgramme(next as Programme | null)}
        options={PROGRAMMES.map((p) => ({ value: p, label: programmeName(p, t) }))}
      />
      {(!programme || MAX_LEVEL[programme] > 1) && (
        <>
          <TasaText variant="label" color={colors.inkMuted} style={styles.label}>
            {t('students.level')}
          </TasaText>
          <SelectField
            title={t('students.chooseLevel')}
            placeholder={t('students.chooseLevel')}
            value={level === null ? null : String(level)}
            disabled={!programme}
            onChange={(next) => setLevel(next === null ? null : Number(next))}
            options={programme ? levelsOf(programme).map((l) => ({ value: String(l), label: levelLabel(programme, l, t) })) : []}
          />
        </>
      )}
      <Input
        label={t('students.matric')}
        placeholder={t('students.matricPlaceholder')}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={25}
        error={matricBad ? t('students.matricInvalid') : null}
        value={matric}
        onChangeText={setMatric}
      />
      <TasaText variant="label" color={colors.inkMuted} style={styles.label}>
        {t('students.admissionYear')}
      </TasaText>
      <SelectField
        title={t('students.admissionYear')}
        placeholder={t('students.chooseAdmissionYear')}
        value={year || null}
        onChange={(next) => setYear(next ?? '')}
        options={admissionYears().map((y) => ({ value: y, label: y }))}
      />
      <ActionSheet
        visible={confirming}
        title={t('students.reverifyTitle')}
        message={t(status === 'pending' ? 'students.reverifyPendingBody' : 'students.reverifyBody')}
        options={[{ label: t('students.reverifyConfirm'), destructive: true, onPress: submit }]}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirming(false)}
      />
    </Screen>
  );
}

/**
 * A choice from the school's list, ending with "isn't listed", which switches to typing their own
 * words (`children`, the text field) with a link back to the list.
 */
function ListedField({
  label,
  placeholder,
  names,
  value,
  unlistedLabel,
  hint,
  typed,
  disabled,
  onChoose,
  onUseList,
  children,
}: {
  label: string;
  placeholder: string;
  names: string[];
  value: string | null;
  unlistedLabel: string;
  hint?: string;
  typed: boolean;
  disabled: boolean;
  onChoose: (name: string) => void;
  onUseList: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  if (typed) {
    return (
      <>
        {children}
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onUseList} style={styles.listLink}>
          <TasaText variant="caption" color={colors.brand}>
            {t('students.chooseFromList')}
          </TasaText>
        </Pressable>
      </>
    );
  }
  return (
    <>
      <TasaText variant="label" color={colors.inkMuted} style={styles.label}>
        {label}
      </TasaText>
      <SelectField
        title={placeholder}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(next) => next !== null && onChoose(next)}
        options={[...names.map((name) => ({ value: name, label: name })), { value: UNLISTED, label: unlistedLabel, pinned: true }]}
      />
      {!!hint && (
        <TasaText variant="caption" color={colors.inkMuted} style={styles.listHint}>
          {hint}
        </TasaText>
      )}
    </>
  );
}

const STATUS_ICON: Record<StudentVerificationStatus, IconName> = {
  unsubmitted: { ios: 'person.text.rectangle', android: 'badge' },
  pending: { ios: 'clock.fill', android: 'schedule' },
  verified: { ios: 'checkmark.seal.fill', android: 'verified' },
  rejected: { ios: 'exclamationmark.triangle.fill', android: 'error' },
};

/**
 * Where their verification stands, and the ways to verify while they aren't: the ID card first
 * (most schools give no email), then school email where it works.
 * Once staff have taken a verification back, only the ID card works.
 */
function Verification({ profile }: { profile: StudentProfileDto }) {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const [emailOpen, setEmailOpen] = useState(false);
  const v = profile.verification;
  const revoked = v.revoked && v.status !== 'verified' && v.status !== 'pending';
  const tone = { unsubmitted: colors.inkMuted, pending: colors.accentHot, verified: colors.success, rejected: colors.danger }[v.status];
  const body =
    v.status === 'verified'
      ? v.method === 'email' && v.email
        ? t('students.verifiedByEmail', { email: v.email })
        : t('students.verifiedByCard')
      : v.status === 'pending'
        ? t('students.pendingBody', { date: v.submittedAt ? formatDate(v.submittedAt) : '' })
        : revoked
          ? t('students.revokedBody')
          : v.status === 'rejected'
            ? t('students.rejectedBody')
            : t('students.unsubmittedBody');
  const canVerify = v.status === 'unsubmitted' || v.status === 'rejected';
  const domain = revoked ? undefined : profile.school?.emailDomains[0];

  return (
    <>
      <SectionHeader title={t('students.verification')} />
      <Card style={{ ...styles.status, borderColor: `${tone}55`, backgroundColor: `${tone}0D` }}>
        <View style={styles.row}>
          <Icon {...STATUS_ICON[v.status]} color={tone} size={22} />
          <TasaText variant="bodyMedium" color={colors.heading} style={styles.flex}>
            {revoked ? t('students.revokedTitle') : t(`students.status.${v.status}`)}
          </TasaText>
        </View>
        {v.status === 'rejected' && !!v.reason && <TasaText variant="body">{v.reason}</TasaText>}
        <TasaText variant="caption" color={colors.inkMuted}>
          {body}
        </TasaText>
      </Card>

      {canVerify && (
        <>
          <CardUpload />
          {!!domain && profile.school && (
            <Pressable accessibilityRole="button" onPress={() => setEmailOpen(true)}>
              <Card style={styles.option}>
                <Icon ios="envelope.fill" android="mail" color={colors.brand} size={22} />
                <View style={styles.flex}>
                  <TasaText variant="bodyMedium">{t('students.withEmail')}</TasaText>
                  <TasaText variant="caption" color={colors.inkMuted}>
                    {t('students.withEmailHint', { school: profile.school.shortName })}
                  </TasaText>
                </View>
                <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />
              </Card>
            </Pressable>
          )}
          {!!domain && <EmailSheet visible={emailOpen} domain={domain} onClose={() => setEmailOpen(false)} />}
        </>
      )}
    </>
  );
}

/** A photo of their student ID card, for Tasa staff to check against their details. */
function CardUpload() {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const { show } = useSnackbar();
  const submit = useSubmitStudentCard();
  const [uri, setUri] = useState<string | null>(null);
  const pick = async () => {
    const picked = await capture([16, 10], false);
    if (picked) setUri(picked);
  };

  return (
    <Card style={styles.cardUpload}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('students.withCard')} onPress={pick} style={styles.row}>
        {uri ? (
          <Image source={uri} contentFit="cover" style={styles.preview} />
        ) : (
          <View style={[styles.preview, styles.previewEmpty]}>
            <Icon ios="creditcard" android="badge" color={colors.accentHot} size={24} />
          </View>
        )}
        <View style={styles.flex}>
          <TasaText variant="bodyMedium">{t('students.withCard')}</TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('students.withCardHint')}
          </TasaText>
          <TasaText variant="caption" color={colors.brand}>
            {t(uri ? 'students.cardRetake' : 'students.cardTake')}
          </TasaText>
        </View>
      </Pressable>
      {uri && (
        <Button
          label={t('students.sendCard')}
          loading={submit.isPending}
          onPress={() =>
            submit.mutate(uri, {
              onSuccess: () => {
                setUri(null);
                show(t('students.cardSent'));
              },
              onError: (error) => show(errorMessage(error), { tone: 'error' }),
            })
          }
        />
      )}
    </Card>
  );
}

/** Their school address, then the code we send to it. Verifies straight away. */
function EmailSheet({ visible, domain, onClose }: { visible: boolean; domain: string; onClose: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const { show } = useSnackbar();
  const send = useSendSchoolEmailCode();
  const verify = useVerifySchoolEmail();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sendCode = (address: string) =>
    send.mutate(address, {
      onSuccess: () => {
        setSentTo(address);
        setCode('');
        setError(null);
      },
      onError: (sendError) => setError(errorMessage(sendError)),
    });
  const check = (digits: string) =>
    verify.mutate(
      { email: sentTo!, code: digits },
      {
        onSuccess: () => {
          onClose();
          show(t('students.verified'));
        },
        onError: (verifyError) => {
          setCode('');
          setError(errorMessage(verifyError));
        },
      },
    );

  return (
    <BottomSheet visible={visible} title={t('students.withEmail')} onClose={onClose}>
      {sentTo ? (
        <View style={styles.sheet}>
          <TasaText variant="body" color={colors.inkMuted}>
            {t('students.codeSent', { email: sentTo })}
          </TasaText>
          <OtpInput
            label={t('students.codeLabel')}
            value={code}
            length={CODE_LENGTH}
            autoFocus
            error={error}
            onChange={(digits) => {
              setCode(digits);
              setError(null);
              if (digits.length === CODE_LENGTH) check(digits);
            }}
          />
          <View style={styles.links}>
            <Pressable accessibilityRole="button" hitSlop={8} disabled={send.isPending} onPress={() => sendCode(sentTo)}>
              <TasaText variant="caption" color={colors.brand}>
                {t('students.resend')}
              </TasaText>
            </Pressable>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setSentTo(null)}>
              <TasaText variant="caption" color={colors.brand}>
                {t('students.changeEmail')}
              </TasaText>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Input
            label={t('students.emailLabel')}
            placeholder={t('students.emailPlaceholder', { domain })}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            last
            error={error}
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              setError(null);
            }}
          />
          <Button
            label={t('students.sendCode')}
            disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
            loading={send.isPending}
            onPress={() => sendCode(email.trim().toLowerCase())}
          />
        </>
      )}
    </BottomSheet>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    intro: {
      marginBottom: theme.spacing.sm,
    },
    label: {
      marginBottom: theme.spacing.xs,
    },
    listLink: {
      alignSelf: 'flex-start',
      marginTop: -theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    listHint: {
      marginTop: -theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: -theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: `${colors.brand}55`,
      backgroundColor: `${colors.brand}0D`,
    },
    status: {
      gap: 6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: theme.spacing.sm,
    },
    cardUpload: {
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    preview: {
      width: 96,
      height: 60,
      borderRadius: theme.radius.md,
      backgroundColor: colors.track,
    },
    previewEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.warmSoftBorder,
      backgroundColor: colors.warmSoft,
    },
    sheet: {
      gap: theme.spacing.sm,
    },
    links: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
  }),
);
